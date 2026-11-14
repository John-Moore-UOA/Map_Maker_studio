"""One-off preprocessing of the LINZ 1m DEM tiles.

Outputs (in ./data):
  mosaic.f32      raw float32 1m mosaic (NaN = nodata), row-major, top row first
  mosaic.json     grid georeference (NZTM2000 / EPSG:2193)
  overview.npy    4m block-mean overview (used for rendering)
  hillshade.png   RGBA, reprojected to Web Mercator
  tint.png        RGBA hypsometric tint, reprojected to Web Mercator
  overlay.json    lat/lng bounds of the PNGs + elevation range
"""
import glob, json, os
import numpy as np
import tifffile
from PIL import Image

from nztm import nztm_forward, nztm_inverse

SRC = os.path.join(os.path.dirname(__file__), "LIDAR_Data")
OUT = os.path.join(os.path.dirname(__file__), "data")
OV = 4  # overview block size (m)
os.makedirs(OUT, exist_ok=True)


def read_tfw(p):
    v = [float(x) for x in open(p).read().split()]
    return v[4] - v[0] / 2, v[5] - v[3] / 2  # top-left pixel *edge*


tiles = []
for tif in sorted(glob.glob(os.path.join(SRC, "*.tif"))):
    x0, y0 = read_tfw(tif[:-4] + ".tfw")
    with tifffile.TiffFile(tif) as t:
        h, w = t.pages[0].shape
    tiles.append((tif, x0, y0, w, h))

E0 = min(t[1] for t in tiles)
NTOP = max(t[2] for t in tiles)
E1 = max(t[1] + t[3] for t in tiles)
NBOT = min(t[2] - t[4] for t in tiles)
W, H = int(round(E1 - E0)), int(round(NTOP - NBOT))
W -= W % OV; H -= H % OV
print("mosaic", W, H)

meta = dict(e0=E0, ntop=NTOP, w=W, h=H, res=1.0, crs="EPSG:2193")
mpath = os.path.join(OUT, "mosaic.f32")
if not os.path.exists(mpath) or os.path.getsize(mpath) != W * H * 4:
    mm = np.memmap(mpath, dtype=np.float32, mode="w+", shape=(H, W))
    mm[:] = np.nan
    for tif, x0, y0, w, h in tiles:
        print("reading", os.path.basename(tif))
        a = tifffile.imread(tif)
        a[a <= -9000] = np.nan
        c, r = int(round(x0 - E0)), int(round(NTOP - y0))
        hh, ww = min(h, H - r), min(w, W - c)
        mm[r:r + hh, c:c + ww] = a[:hh, :ww]
        del a
    mm.flush(); del mm
json.dump(meta, open(os.path.join(OUT, "mosaic.json"), "w"), indent=1)

# ---- overview -------------------------------------------------------------
mm = np.memmap(mpath, dtype=np.float32, mode="r", shape=(H, W))
ov = np.empty((H // OV, W // OV), np.float32)
for r in range(0, H, 1024):
    blk = np.array(mm[r:r + 1024]).reshape(-1, OV, W // OV, OV)
    with np.errstate(all="ignore"):
        import warnings; warnings.simplefilter("ignore")
        ov[r // OV:(r + 1024) // OV] = np.nanmean(blk, axis=(1, 3))
np.save(os.path.join(OUT, "overview.npy"), ov)
zmin, zmax = float(np.nanmin(ov)), float(np.nanmax(ov))
print("elev range", zmin, zmax)

# hillshade (multi-directional-ish blend) on overview grid
z = np.where(np.isnan(ov), np.nanmin(ov), ov)
gy, gx = np.gradient(z, OV)  # gy is d/drow (south-positive)
slope = np.arctan(np.hypot(gx, gy) * 1.5)
asp = np.arctan2(-gy, gx)  # direction of increasing z, math angle (east=0, north=pi/2)
def shade(az, alt):
    azr = np.radians(90 - az); altr = np.radians(alt)
    return np.sin(altr) * np.cos(slope) + np.cos(altr) * np.sin(slope) * np.cos(azr - asp + np.pi)
hs = np.clip(0.6 * shade(315, 45) + 0.4 * shade(270, 50), 0, 1)

# tint colour ramp
stops = np.array([0, .08, .25, .5, .75, 1.0])
cols = np.array([[46, 120, 70], [120, 170, 90], [215, 210, 130], [190, 140, 80], [150, 110, 90], [245, 245, 245]], float)
t = np.clip((z - zmin) / (zmax - zmin), 0, 1)
tint = np.stack([np.interp(t, stops, cols[:, i]) for i in range(3)], -1)

# ---- reproject to Web Mercator -------------------------------------------
oh, ow = ov.shape
bx = np.r_[np.linspace(E0, E0 + W, 50), np.full(50, E0 + W), np.linspace(E0, E0 + W, 50), np.full(50, E0)]
by = np.r_[np.full(50, NTOP), np.linspace(NTOP, NTOP - H, 50), np.full(50, NTOP - H), np.linspace(NTOP, NTOP - H, 50)]
lat, lon = nztm_inverse(bx, by)
south, north, west, east = lat.min(), lat.max(), lon.min(), lon.max()
R = 6378137.0
mx = lambda lo: np.radians(lo) * R
my = lambda la: R * np.log(np.tan(np.pi / 4 + np.radians(la) / 2))
X0, X1, Y0, Y1 = mx(west), mx(east), my(south), my(north)
OW = 4096; OH = int(OW * (Y1 - Y0) / (X1 - X0))
xs = X0 + (np.arange(OW) + .5) * (X1 - X0) / OW
ys = Y1 - (np.arange(OH) + .5) * (Y1 - Y0) / OH
LON = np.degrees(xs / R)[None, :].repeat(OH, 0)
LAT = np.degrees(2 * np.arctan(np.exp(ys / R)) - np.pi / 2)[:, None].repeat(OW, 1)
E, N = nztm_forward(LAT, LON)
ci = ((E - E0) / OV).astype(int); ri = ((NTOP - N) / OV).astype(int)
ok = (ci >= 0) & (ci < ow) & (ri >= 0) & (ri < oh)
ci = np.clip(ci, 0, ow - 1); ri = np.clip(ri, 0, oh - 1)
valid = ok & ~np.isnan(ov[ri, ci])
alpha = (valid * 255).astype(np.uint8)

g = (hs[ri, ci] * 255).astype(np.uint8)
Image.fromarray(np.dstack([g, g, g, alpha])).save(os.path.join(OUT, "hillshade.png"), optimize=True)
tc = tint[ri, ci].astype(np.uint8)
Image.fromarray(np.dstack([tc, alpha])).save(os.path.join(OUT, "tint.png"), optimize=True)

json.dump(dict(bounds=[[south, west], [north, east]], zmin=zmin, zmax=zmax,
               nztm=dict(e0=E0, ntop=NTOP, e1=E0 + W, nbot=NTOP - H)),
          open(os.path.join(OUT, "overlay.json"), "w"), indent=1)
print("done")
