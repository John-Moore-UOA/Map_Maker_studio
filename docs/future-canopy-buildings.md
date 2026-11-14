# Future module: tree canopy and building heights from imagery

Status: planned, not built. This note is the contract so it can slot into the studio later
as two more grid kinds (`canopy`, `buildings`) served by the same `/api/derive` pattern.

## Goal
For the selected area only (never the whole mosaic), estimate:
1. Canopy height model (CHM): metres of vegetation above ground, per cell.
2. Building footprints with a height each.

Then render them as studio layers: canopy as a stippled/green raster or tree symbols, buildings as
extruded 2.5D blocks (oblique, shadowed) or flat footprints with height labels.

## What we already have that makes this easier than "from a satellite picture"
The LINZ 1 m DEM is a *bare-earth* model. LINZ also publishes a 1 m **DSM** (first-return surface)
for the same tiles. `DSM − DEM = nDSM` gives a normalised height of everything above ground
(trees, buildings) at 1 m, with no machine learning. That is the first thing to do.

## Phase A (cheap, accurate): nDSM from LINZ DSM
- Download the matching DSM tiles (same BC35..BD37 ids) into `LIDAR_Data_DSM/`.
- `prep.py`: build `dsm.f32` mosaic the same way as `mosaic.f32`.
- `serve.py`: `kind=ndsm` returns `DSM − DEM`, clamped at 0, NaN where either is nodata.
- Studio modules: `canopy` raster (nDSM where > 2 m and "rough"), `buildings` (nDSM where > 2.5 m and
  locally planar). Separation rule: roughness (already a derive kind) of the nDSM within a 3 m window is
  high for trees and low for roofs; slope of the DSM is steep at roof edges. A simple threshold pair
  gets 80–90 % right in suburban NZ.

## Phase B (open source, imagery-based) for areas without a DSM or to refresh older LiDAR
Pick one of these, all open source, run only on the selected bbox:
- **Open Buildings / Microsoft Building Footprints** (vector footprints, free download, cover NZ). Clip to
  bbox, then read height off the nDSM, or if no DSM, use the shadow-length method below.
- **Canopy height from imagery**: Meta/WRI *High Resolution Canopy Height* (1 m, global, CC-BY) can be
  fetched for the bbox as a GeoTIFF. No model to run locally. Fallback: run the open model
  `facebookresearch/HighResCanopyHeight` on a Sentinel-2 or aerial chip (needs GPU, ~minutes per km²).
- **Building height from a single ortho image** (no DSM): detect footprint, measure shadow length along the
  solar azimuth (from image metadata: date, time, lat/lng), height = shadow_len × tan(sun_elevation).
  Fully deterministic, decent for isolated buildings, poor in dense areas.
- **Aerial imagery source for NZ**: LINZ Data Service aerial basemap (CC-BY 4.0) at 7.5–30 cm, WMTS.

## Pipeline sketch (server side, bbox only)
```
POST /api/derive?kind=canopy&e0..n1&res
  1 cache check (bbox+res hash)
  2 fetch nDSM crop  (Phase A)  or  fetch imagery chip + run model (Phase B)
  3 classify: tree / building / ground
  4 return float32 grid (height m, NaN elsewhere) + X-Grid header
POST /api/derive?kind=buildings  -> same, but returns GeoJSON footprints with height attr
```
Long jobs (Phase B) need an async job id and polling; the studio status bar already has a "busy" slot.

## Studio layers to add once grids exist
- `canopy` (raster): height ramp, or dot stipple with density ∝ height, or a hand-drawn tree glyph scatter.
- `buildings` (vector): footprints extruded as oblique prisms (shear by height × exaggeration), with a
  cast shadow polygon in the hillshade light direction, or flat fills with height labels.
- Both respect the area clip, blend modes and SVG export like every other module.

## Open questions
- Licence check for redistributing any derived product in printed maps (LINZ CC-BY is fine; attribute).
- Whether to also expose `kind=ndsm` raw, so users can design their own styles from it.
