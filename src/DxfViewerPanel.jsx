import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { DxfViewer } from "dxf-viewer"
import * as THREE from "three"
import { computeSnap } from "./snap"
import { detect3D } from "./detect3d"
import fontUrl from "./fonts/Roboto-Regular.ttf?url"

const ACCENT = 0xff7849

const markerMaterial = new THREE.PointsMaterial({
  color: ACCENT,
  size: 9,
  sizeAttenuation: false,
  depthTest: false,
})
const lineMaterial = new THREE.LineBasicMaterial({
  color: ACCENT,
  depthTest: false,
})
const rubberMaterial = new THREE.LineBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.55,
  depthTest: false,
})
const SNAP_VERTEX_COLOR = 0x34d399 // endpoint/vertex snap
const SNAP_EDGE_COLOR = 0x22d3ee // nearest point on a line
const snapMaterial = new THREE.PointsMaterial({
  color: SNAP_VERTEX_COLOR,
  size: 14,
  sizeAttenuation: false,
  depthTest: false,
})

/* Click vs drag discrimination threshold, canvas pixels. */
const CLICK_SLOP = 5

function makeMarker(p) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(p.x, p.y, 0),
  ])
  const marker = new THREE.Points(geometry, markerMaterial)
  marker.renderOrder = 20
  return marker
}

function makeLine(a, b, material = lineMaterial) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a.x, a.y, 0),
    new THREE.Vector3(b.x, b.y, 0),
  ])
  const line = new THREE.Line(geometry, material)
  line.renderOrder = 19
  return line
}

/* Project a scene-space point to canvas CSS pixel coordinates. */
function sceneToCanvas(viewer, p) {
  const v = new THREE.Vector3(p.x, p.y, 0).project(viewer.GetCamera())
  const canvas = viewer.GetCanvas()
  return {
    x: ((v.x + 1) / 2) * canvas.clientWidth,
    y: ((1 - v.y) / 2) * canvas.clientHeight,
  }
}

/* Inverse of the above, same formula the viewer uses for its pointer events. */
function canvasToScene(viewer, x, y) {
  const canvas = viewer.GetCanvas()
  const v = new THREE.Vector3(
    (x * 2) / canvas.clientWidth - 1,
    (-y * 2) / canvas.clientHeight + 1,
    1,
  ).unproject(viewer.GetCamera())
  return { x: v.x, y: v.y }
}

export function formatDistance(d) {
  if (!isFinite(d)) return "-"
  if (d >= 1000) return d.toFixed(1)
  if (d >= 10) return d.toFixed(2)
  return d.toFixed(3)
}

const DxfViewerPanel = forwardRef(function DxfViewerPanel(
  { measureMode, snapEnabled, onMeasurementsChanged, onPendingChanged },
  ref,
) {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const measureModeRef = useRef(measureMode)
  const snapEnabledRef = useRef(snapEnabled)
  const snapMarkerRef = useRef(null)
  const pointerDownRef = useRef(null)
  /* First picked point + its three.js objects while awaiting the second pick. */
  const pendingRef = useRef(null)
  /* Group holding every overlay object; recreated after each scene load. */
  const overlayGroupRef = useRef(null)
  const measurementsRef = useRef([])
  const idRef = useRef(0)
  const [measurements, setMeasurements] = useState([])
  /* Bumped on camera moves so measurement labels re-project. */
  const [, setViewTick] = useState(0)

  const publishMeasurements = (list) => {
    measurementsRef.current = list
    setMeasurements(list)
    /* Exposed for end-to-end tests. */
    window.__measurements = list
    onMeasurementsChanged?.(list)
  }

  const overlayGroup = () => {
    const viewer = viewerRef.current
    if (!overlayGroupRef.current) {
      overlayGroupRef.current = new THREE.Group()
      viewer.GetScene().add(overlayGroupRef.current)
    }
    return overlayGroupRef.current
  }

  const showSnapMarker = (snap) => {
    const group = overlayGroup()
    let marker = snapMarkerRef.current
    if (!marker || marker.parent !== group) {
      marker = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
        snapMaterial,
      )
      marker.renderOrder = 21
      group.add(marker)
      snapMarkerRef.current = marker
    }
    marker.geometry.attributes.position.setXYZ(0, snap.x, snap.y, 0)
    marker.geometry.attributes.position.needsUpdate = true
    snapMaterial.color.set(
      snap.type === "vertex" ? SNAP_VERTEX_COLOR : SNAP_EDGE_COLOR,
    )
    marker.visible = true
  }

  const hideSnapMarker = () => {
    const marker = snapMarkerRef.current
    const wasVisible = marker?.visible ?? false
    if (marker) marker.visible = false
    return wasVisible
  }

  /* Snap a picked/hovered position when snapping is on. */
  const applySnap = (position) => {
    if (!snapEnabledRef.current) return { position, snap: null }
    const snap = computeSnap(
      viewerRef.current,
      position,
      overlayGroupRef.current,
    )
    return snap ? { position: { x: snap.x, y: snap.y }, snap } : { position, snap: null }
  }

  const cancelPending = () => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    overlayGroupRef.current?.remove(pending.marker, pending.rubber)
    pending.marker.geometry.dispose()
    pending.rubber.geometry.dispose()
    viewerRef.current?.Render()
    onPendingChanged?.(false)
  }

  const handlePick = (rawPosition) => {
    const viewer = viewerRef.current
    const { position } = applySnap(rawPosition)
    const pending = pendingRef.current
    if (!pending) {
      const marker = makeMarker(position)
      const rubber = makeLine(position, position, rubberMaterial)
      overlayGroup().add(marker, rubber)
      pendingRef.current = { a: position, marker, rubber }
      onPendingChanged?.(true)
    } else {
      pendingRef.current = null
      overlayGroup().remove(pending.rubber)
      pending.rubber.geometry.dispose()
      const marker = makeMarker(position)
      const line = makeLine(pending.a, position)
      overlayGroup().add(marker, line)
      const a = pending.a
      const b = position
      const measurement = {
        id: ++idRef.current,
        a,
        b,
        dx: Math.abs(b.x - a.x),
        dy: Math.abs(b.y - a.y),
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        objects: [pending.marker, marker, line],
      }
      publishMeasurements([...measurementsRef.current, measurement])
      onPendingChanged?.(false)
    }
    viewer.Render()
  }

  useEffect(() => {
    const viewer = new DxfViewer(containerRef.current, {
      autoResize: true,
      colorCorrection: true,
      clearColor: new THREE.Color("#0b0e13"),
      retainParsedDxf: true, // keeps the header available for the units readout
    })
    viewerRef.current = viewer
    /* Exposed for end-to-end tests. */
    window.__dxfViewer = viewer

    const onPointerDown = (e) => {
      pointerDownRef.current = e.detail.canvasCoord
    }
    const onPointerUp = (e) => {
      const down = pointerDownRef.current
      pointerDownRef.current = null
      if (!down || !measureModeRef.current) return
      const up = e.detail.canvasCoord
      if (Math.hypot(up.x - down.x, up.y - down.y) > CLICK_SLOP) return
      handlePick(e.detail.position)
    }
    const onViewChanged = () => setViewTick((t) => t + 1)
    const onCleared = () => {
      /* Load() wipes the scene, overlay objects included. */
      overlayGroupRef.current = null
      snapMarkerRef.current = null
      pendingRef.current = null
      publishMeasurements([])
      onPendingChanged?.(false)
    }
    viewer.Subscribe("pointerdown", onPointerDown)
    viewer.Subscribe("pointerup", onPointerUp)
    viewer.Subscribe("viewChanged", onViewChanged)
    viewer.Subscribe("resized", onViewChanged)
    viewer.Subscribe("cleared", onCleared)

    const canvas = viewer.GetCanvas()
    const onPointerMove = (e) => {
      if (!measureModeRef.current || !viewer.GetBounds()) return
      const rect = canvas.getBoundingClientRect()
      const raw = canvasToScene(viewer, e.clientX - rect.left, e.clientY - rect.top)
      const { position, snap } = applySnap(raw)
      let needsRender = false
      if (snap) {
        showSnapMarker(snap)
        needsRender = true
      } else {
        needsRender = hideSnapMarker()
      }
      const pending = pendingRef.current
      if (pending) {
        pending.rubber.geometry.setFromPoints([
          new THREE.Vector3(pending.a.x, pending.a.y, 0),
          new THREE.Vector3(position.x, position.y, 0),
        ])
        needsRender = true
      }
      if (needsRender) viewer.Render()
    }
    const onKeyDown = (e) => {
      if (e.key === "Escape") cancelPending()
    }
    canvas.addEventListener("pointermove", onPointerMove)
    window.addEventListener("keydown", onKeyDown)

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("keydown", onKeyDown)
      viewer.Destroy()
      canvas.remove() // Destroy() does not detach the canvas from the container
      if (window.__dxfViewer === viewer) delete window.__dxfViewer
      viewerRef.current = null
      overlayGroupRef.current = null
      pendingRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    measureModeRef.current = measureMode
    const viewer = viewerRef.current
    if (viewer) viewer.GetCanvas().style.cursor = measureMode ? "crosshair" : ""
    if (!measureMode) {
      cancelPending()
      if (hideSnapMarker()) viewer?.Render()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode])

  useEffect(() => {
    snapEnabledRef.current = snapEnabled
    if (!snapEnabled && hideSnapMarker()) viewerRef.current?.Render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapEnabled])

  useImperativeHandle(ref, () => ({
    async loadUrl(url) {
      const viewer = viewerRef.current
      await viewer.Load({ url, fonts: [fontUrl] })
      viewer.Render()
      const dxf = viewer.GetDxf()
      const header = dxf?.header ?? {}
      return {
        insunits: header["$INSUNITS"] ?? null,
        /* The viewer renders the XY projection; flag 3D input so the UI
           can say the drawing was flattened. */
        is3D: detect3D(dxf),
      }
    },
    fitView() {
      const viewer = viewerRef.current
      const bounds = viewer?.GetBounds()
      if (!bounds) return
      const origin = viewer.GetOrigin()
      viewer.FitView(
        bounds.minX - origin.x,
        bounds.maxX - origin.x,
        bounds.minY - origin.y,
        bounds.maxY - origin.y,
        0.08,
      )
      viewer.Render()
      setViewTick((t) => t + 1)
    },
    clearMeasurements() {
      cancelPending()
      const group = overlayGroupRef.current
      if (group) {
        for (const m of measurementsRef.current) {
          group.remove(...m.objects)
          m.objects.forEach((o) => o.geometry.dispose())
        }
      }
      publishMeasurements([])
      viewerRef.current?.Render()
    },
  }))

  /* Project measurement midpoints for the floating labels. */
  const viewer = viewerRef.current
  const labels = viewer
    ? measurements.map((m) => {
        const mid = sceneToCanvas(viewer, {
          x: (m.a.x + m.b.x) / 2,
          y: (m.a.y + m.b.y) / 2,
        })
        return { id: m.id, x: mid.x, y: mid.y, text: formatDistance(m.distance) }
      })
    : []

  return (
    <div className="viewer-wrap">
      <div ref={containerRef} className="viewer-canvas" />
      {labels.map((l) => (
        <div
          key={l.id}
          className="measure-label"
          style={{ left: `${l.x}px`, top: `${l.y}px` }}
        >
          {l.text}
        </div>
      ))}
    </div>
  )
})

export default DxfViewerPanel
