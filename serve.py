"""Tiny local server: static files + DEM API.   python serve.py  ->  http://localhost:8765

GET /api/elev?e=&n=                      -> {"z": float|null}   (NZTM metres)
GET /api/dem?e0=&n0=&e1=&n1=&res=        -> float32 grid (top row first), JSON info in X-Grid header
     bbox in NZTM; res = metres/cell (integer >=1, block-mean). Auto-coarsened above MAX_CELLS.
GET /api/derive?kind=&...dem args&[p=]    -> float32 grid of a terrain derivative, same X-Grid header
     kind: slope (deg) | aspect (deg, 0=N cw) | curvature (1/m, +convex) | tpi (m, p=radius m)
           flow (log10 D8 accumulation cells) | smooth (p=sigma m) | roughness (p=radius m)
"""
import json, os, math, warnings
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np
from scipy import ndimage

ROOT = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(ROOT, "data")
M = json.load(open(os.path.join(D, "mosaic.json")))
DEM = np.memmap(os.path.join(D, "mosaic.f32"), dtype=np.float32, mode="r", shape=(M["h"], M["w"]))
MAX_CELLS = 6_000_000
warnings.simplefilter("ignore")


def crop(e0, n0, e1, n1, res):
    c0 = max(0, int(math.floor(min(e0, e1) - M["e0"])))
    c1 = min(M["w"], int(math.ceil(max(e0, e1) - M["e0"])))
    r0 = max(0, int(math.floor(M["ntop"] - max(n0, n1))))
    r1 = min(M["h"], int(math.ceil(M["ntop"] - min(n0, n1))))
    if c1 <= c0 or r1 <= r0:
        return None, None
    res = max(1, int(res))
    while ((c1 - c0) // res) * ((r1 - r0) // res) > MAX_CELLS:
        res += 1
    c1 = c0 + (c1 - c0) // res * res; r1 = r0 + (r1 - r0) // res * res
    a = np.array(DEM[r0:r1, c0:c1])
    if res > 1:
        a = np.nanmean(a.reshape((r1 - r0) // res, res, (c1 - c0) // res, res), axis=(1, 3))
    info = dict(e0=M["e0"] + c0, ntop=M["ntop"] - r0, w=a.shape[1], h=a.shape[0], res=res)
    return a.astype(np.float32), info


def derive(a, res, kind, p):
    """Terrain derivative of grid a (NaN nodata). Returns float32 with NaN preserved."""
    nan = np.isnan(a)
    if nan.all():
        return a
    z = a.copy()
    if nan.any():  # fill holes with nearest valid so gradients don't explode
        idx = ndimage.distance_transform_edt(nan, return_distances=False, return_indices=True)
        z = z[tuple(idx)]
    gy, gx = np.gradient(z, res)  # gy = d/drow (south+)
    if kind == "slope":
        out = np.degrees(np.arctan(np.hypot(gx, gy)))
    elif kind == "aspect":
        out = (np.degrees(np.arctan2(gx, gy)) + 180) % 360  # downslope dir, 0=N clockwise
        out[np.hypot(gx, gy) < 1e-6] = -1
    elif kind == "curvature":
        gyy, _ = np.gradient(gy, res); _, gxx = np.gradient(gx, res)
        out = -(gxx + gyy)  # laplacian sign-flipped: + = convex (ridge)
    elif kind == "tpi":
        r = max(1, int(round((p or 30) / res)))
        out = z - ndimage.uniform_filter(z, 2 * r + 1, mode="nearest")
    elif kind == "roughness":
        r = max(1, int(round((p or 10) / res)))
        m = ndimage.uniform_filter(z, 2 * r + 1, mode="nearest")
        out = np.sqrt(np.maximum(ndimage.uniform_filter(z * z, 2 * r + 1, mode="nearest") - m * m, 0))
    elif kind == "smooth":
        out = ndimage.gaussian_filter(z, max(0.1, (p or 5) / res), mode="nearest")
    elif kind == "flow":
        out = flow_accum(z)
    else:
        raise ValueError("unknown kind " + kind)
    out = out.astype(np.float32); out[nan] = np.nan
    return out


def flow_accum(z):
    """D8 flow accumulation, log10(cells). Processes cells highest-first (O(n log n))."""
    h, w = z.shape
    zp = np.pad(z, 1, mode="constant", constant_values=-np.inf)
    best = np.full((h, w), -1, np.int64); bestdrop = np.zeros((h, w))
    offs = [(-1,-1,1.414),(-1,0,1),(-1,1,1.414),(0,-1,1),(0,1,1),(1,-1,1.414),(1,0,1),(1,1,1.414)]
    for dr, dc, d in offs:
        drop = (z - zp[1+dr:1+dr+h, 1+dc:1+dc+w]) / d
        better = drop > bestdrop
        bestdrop[better] = drop[better]
        rr = np.clip(np.arange(h)[:, None] + dr, 0, h - 1); cc = np.clip(np.arange(w)[None, :] + dc, 0, w - 1)
        tgt = (rr * w + cc)
        best[better] = tgt[better]
    acc = np.ones(h * w); order = np.argsort(-z.ravel(), kind="stable"); best = best.ravel()
    for i in order:
        t = best[i]
        if t >= 0: acc[t] += acc[i]
    return np.log10(acc.reshape(h, w))


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]): return
        super().log_message(fmt, *args)

    def _send(self, body, ctype, extra=None):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path); q = {}
        for k, v in parse_qs(u.query).items():
            try: q[k] = float(v[0])
            except ValueError: pass
        if u.path == "/api/elev":
            c = int(q["e"] - M["e0"]); r = int(M["ntop"] - q["n"])
            z = None
            if 0 <= c < M["w"] and 0 <= r < M["h"]:
                v = float(DEM[r, c]); z = None if math.isnan(v) else round(v, 2)
            return self._send(json.dumps({"z": z}).encode(), "application/json")
        if u.path == "/api/derive":
            kind = parse_qs(u.query).get("kind", ["slope"])[0]
            a, info = crop(q["e0"], q["n0"], q["e1"], q["n1"], q.get("res", 1))
            if a is None:
                return self._send(b"{}", "application/json")
            out = derive(a, info["res"], kind, q.get("p"))
            return self._send(out.tobytes(), "application/octet-stream",
                              {"X-Grid": json.dumps(info), "Access-Control-Expose-Headers": "X-Grid"})
        if u.path == "/api/dem":
            a, info = crop(q["e0"], q["n0"], q["e1"], q["n1"], q.get("res", 1))
            if a is None:
                return self._send(b"{}", "application/json")
            return self._send(a.tobytes(), "application/octet-stream",
                              {"X-Grid": json.dumps(info), "Access-Control-Expose-Headers": "X-Grid"})
        if u.path == "/": self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    print("http://localhost:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()
