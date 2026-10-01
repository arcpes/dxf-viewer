import { useRef, useState } from "react"
import DxfViewerPanel, { formatDistance } from "./DxfViewerPanel"
import "./App.css"

const INSUNITS_LABELS = {
  0: "units",
  1: "in",
  2: "ft",
  3: "mi",
  4: "mm",
  5: "cm",
  6: "m",
  7: "km",
  10: "yd",
  13: "µm",
  14: "dm",
}

export default function App() {
  const panelRef = useRef(null)
  const fileInputRef = useRef(null)
  const [fileName, setFileName] = useState(null)
  const [status, setStatus] = useState({ state: "empty" })
  const [units, setUnits] = useState("units")
  const [is3D, setIs3D] = useState(false)
  const [measureMode, setMeasureMode] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [measurements, setMeasurements] = useState([])
  const [pendingPick, setPendingPick] = useState(false)

  const openFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = "" // allow re-selecting the same file
    if (!file) return
    const url = URL.createObjectURL(file)
    setFileName(file.name)
    setStatus({ state: "loading" })
    try {
      const info = await panelRef.current.loadUrl(url)
      setUnits(INSUNITS_LABELS[info.insunits] ?? "units")
      setIs3D(info.is3D)
      setStatus({ state: "ready" })
    } catch (err) {
      setStatus({ state: "error", message: String(err?.message ?? err) })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const last = measurements[measurements.length - 1]
  const loaded = status.state === "ready"

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">DXF Viewer</span>

        <button
          className="btn primary"
          onClick={() => fileInputRef.current.click()}
        >
          Open DXF…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf"
          hidden
          onChange={openFile}
        />

        <div className="divider" />

        <button
          className={`btn${measureMode ? " active" : ""}`}
          disabled={!loaded}
          onClick={() => setMeasureMode((m) => !m)}
          title="Measure the distance between two points"
        >
          📏 Measure
        </button>
        <button
          className={`btn${snapEnabled ? " active snap" : ""}`}
          disabled={!loaded}
          onClick={() => setSnapEnabled((s) => !s)}
          title="Snap picked points to the nearest vertex or line"
        >
          🧲 Snap
        </button>
        <button
          className="btn"
          disabled={measurements.length === 0}
          onClick={() => panelRef.current.clearMeasurements()}
        >
          Clear
        </button>
        <button
          className="btn"
          disabled={!loaded}
          onClick={() => panelRef.current.fitView()}
        >
          Fit view
        </button>

        <div className="divider" />

        <div className="readout">
          {last ? (
            <>
              <span className="readout-main">
                {formatDistance(last.distance)} {units}
              </span>
              <span className="readout-sub">
                ΔX {formatDistance(last.dx)} · ΔY {formatDistance(last.dy)}
                {measurements.length > 1 && ` · ${measurements.length} measurements`}
              </span>
            </>
          ) : (
            <span className="readout-sub">
              {measureMode
                ? pendingPick
                  ? "Click the second point (Esc cancels)"
                  : "Click the first point"
                : "No measurements"}
            </span>
          )}
        </div>

        <span className="file-name">{fileName ?? ""}</span>
      </header>

      {status.state === "error" && (
        <div className="banner error">Failed to load: {status.message}</div>
      )}
      {status.state === "loading" && (
        <div className="banner">Loading {fileName}…</div>
      )}
      {status.state === "ready" && is3D && (
        <div className="banner info">
          3D coordinates detected — the drawing is flattened to a 2D top view
          (Z axis ignored); measurements are XY-plane distances.
        </div>
      )}

      <main className="viewer-area">
        <DxfViewerPanel
          ref={panelRef}
          measureMode={measureMode}
          snapEnabled={snapEnabled}
          onMeasurementsChanged={setMeasurements}
          onPendingChanged={setPendingPick}
        />
        {status.state === "empty" && (
          <div className="placeholder">
            <p>Open a DXF file to preview it.</p>
            <p className="placeholder-sub">
              Pan: drag · Zoom: scroll · Measure: toolbar 📏 then click two
              points
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
