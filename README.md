# DXF Viewer

React app for previewing DXF files in the browser, built on
[dxf-viewer](https://github.com/vagran/dxf-viewer) (WebGL / three.js).

## Features

- **Open DXF…** — upload and preview a local DXF file (pan: drag, zoom: scroll)
- **📏 Measure** — click two points to measure the distance between them;
  shows the distance (in the drawing's `$INSUNITS`), ΔX/ΔY, a floating label
  at the midpoint, and a live rubber-band line while picking (Esc cancels)
- **🧲 Snap** (on by default) — picked points snap to the nearest geometry
  within 12 px: endpoints/vertices take priority (green indicator), then the
  nearest point on a line (cyan indicator)
- **3D files are flattened** — drawings with Z coordinates render as a 2D
  top view (XY projection, Z ignored); a banner says so, and measurements
  report XY-plane distances
- **Clear** — remove all measurements
- **Fit view** — zoom to the drawing extents
- TEXT entities render using the bundled Roboto font

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## End-to-end test

With the dev server running on port 5199
(`npm run dev -- --port 5199`):

```bash
node e2e-test.mjs
```

Uploads a sample DXF, measures a distance, and verifies the displayed value
against the viewer's own coordinate transform. Expects a Playwright Chromium
binary at `~/.cache/ms-playwright/chromium-1223/` (adjust `exe` in the script
otherwise).

## Implementation notes

- `src/DxfViewerPanel.jsx` wraps the `DxfViewer` instance (created once per
  mount, destroyed on unmount; the canvas must be detached manually).
- Pointer picks come from the viewer's `pointerdown`/`pointerup` events
  (`e.detail.position` is in scene coordinates — origin already subtracted —
  so they can be used directly for the three.js overlay objects).
- `GetBounds()` is in model space; `FitView()` expects scene space, so the
  origin is subtracted when fitting.
- Measurement markers use `sizeAttenuation: false` so they keep a constant
  screen size at any zoom; overlay objects disable depth testing to stay on
  top of the drawing.
- Flattening is inherent to dxf-viewer: it builds 2-component (XY) geometry
  buffers, so Z never reaches the GPU — and the measure/snap tools read those
  same buffers, so distances are XY projections by construction.
  `src/detect3d.js` just detects nonzero Z/elevation in the parsed document
  to surface the "flattened" banner (`extrusionDirection` excluded — a
  negative Z there is a mirrored 2D entity, not 3D content). Limitations
  inherited from dxf-viewer: arbitrary OCS orientations aren't fully
  supported, and ACIS solids (3DSOLID/REGION/SURFACE) aren't rendered.
- Snapping (`src/snap.js`) scans the rendered geometry buffers directly in 2D
  rather than using `THREE.Raycaster`: dxf-viewer stores positions as
  2-component attributes for its custom shaders, which the stock raycaster
  misreads as 3-component. Instanced block batches are skipped (their
  per-instance transforms live in attributes the scan doesn't apply).
