# MapMaker Studio

Design stylised, print-ready terrain maps from LiDAR. Pick an area on a map, stack analysis
modules (contours, hillshade, slope, aspect, streams, ridgelines, hachures, elevation bands, …)
with artistic style presets, then export PNG at print DPI or editable SVG.

Built on the LINZ 1 m DEM for the Bay of Plenty tiles BC35–BD37 (NZTM2000 / EPSG:2193), but any
set of 1 m GeoTIFF + TFW tiles in NZTM will work.

## Run

```
pip install numpy scipy tifffile pillow
# put LINZ DEM tiles (*.tif + *.tfw) in LIDAR_Data/
python prep.py          # one-off: builds data/mosaic.f32, overview, hillshade/tint PNGs
python serve.py         # http://localhost:8765
```

Append `#demo` (or `#demo:Ridgelines`, `#demo:Woodcut`, …) to the URL to jump straight to a composed page.

## Workflow

1. **Select** – draw a rectangle, circle or polygon (editable Bezier boundary), choose paper size, orientation, margin and sample resolution.
2. **Compose** – choose a preset, then edit the layer stack: reorder, blend modes, opacity, every parameter live.
3. **Export** – PNG (150/300/600 DPI), SVG (vector layers stay editable), contours GeoJSON, project JSON.

## Modules

Raster: hillshade, elevation tint, slope, aspect, TPI ridges & valleys, curvature, roughness, paper texture, vignette.
Vector: contours (with labels), elevation bands, ridgelines / wire mesh (2.5D), hachures, streams (D8 flow), NZTM grid, area outline, frame & title.

## Server API

```
GET /api/elev?e=&n=                         elevation at an NZTM point
GET /api/dem?e0=&n0=&e1=&n1=&res=           float32 grid, georef in X-Grid header
GET /api/derive?kind=&...&p=                slope | aspect | curvature | tpi | roughness | smooth | flow
```

## Roadmap

Tree canopy and building height modules (from LINZ DSM, or imagery) are planned; see
`docs/future-canopy-buildings.md`.

## Licence / data

Elevation data © LINZ, CC BY 4.0. Code MIT.
