import * as THREE from "three"

/* Snap radius around the cursor, in screen pixels. */
const SNAP_PX = 12

const IDENTITY = new THREE.Matrix4()
const tmp = new THREE.Vector3()

/* Snap tolerance in world units at the current zoom level. */
export function snapTolerance(viewer) {
  const cam = viewer.GetCamera()
  const canvas = viewer.GetCanvas()
  return (
    ((cam.right - cam.left) / cam.zoom / Math.max(1, canvas.clientWidth)) *
    SNAP_PX
  )
}

/**
 * Find the best snap target near scene-space point `p`.
 *
 * Scans the rendered geometry buffers directly instead of using
 * THREE.Raycaster: dxf-viewer stores positions as 2-component attributes for
 * its custom shaders, which the stock raycaster misreads as 3-component.
 *
 * Vertices/endpoints win over nearest-point-on-segment candidates.
 *
 * @returns {{x, y, type: "vertex"|"edge"}|null}
 */
export function computeSnap(viewer, p, exclude) {
  const tol = snapTolerance(viewer)
  let bestVertex = null
  let bestEdge = null

  const considerVertex = (x, y) => {
    const d = Math.hypot(x - p.x, y - p.y)
    if (d <= tol && (!bestVertex || d < bestVertex.d)) bestVertex = { d, x, y }
  }
  const considerSegment = (ax, ay, bx, by) => {
    considerVertex(ax, ay)
    considerVertex(bx, by)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return
    const t = Math.max(
      0,
      Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2),
    )
    const qx = ax + t * dx
    const qy = ay + t * dy
    const d = Math.hypot(qx - p.x, qy - p.y)
    if (d <= tol && (!bestEdge || d < bestEdge.d)) {
      bestEdge = { d, x: qx, y: qy }
    }
  }

  viewer.GetScene().traverse((obj) => {
    if (exclude && (obj === exclude || obj.parent === exclude)) return
    if (!(obj.isPoints || obj.isLine)) return
    const geo = obj.geometry
    /* Instanced batches carry per-instance transforms the buffers alone
       don't describe; skip them rather than snap to wrong places. */
    if (!geo || geo.isInstancedBufferGeometry) return
    const pos = geo.attributes?.position
    if (!pos) return

    const stride = pos.itemSize
    const arr = pos.array
    const m = obj.matrixWorld
    const transformed = !m.equals(IDENTITY)
    const read = (i, out) => {
      out[0] = arr[i * stride]
      out[1] = arr[i * stride + 1]
      if (transformed) {
        tmp.set(out[0], out[1], 0).applyMatrix4(m)
        out[0] = tmp.x
        out[1] = tmp.y
      }
    }
    const idx = geo.index
    const count = idx ? idx.count : pos.count
    const vi = (k) => (idx ? idx.getX(k) : k)
    const A = [0, 0]
    const B = [0, 0]

    if (obj.isPoints) {
      for (let k = 0; k < count; k++) {
        read(vi(k), A)
        considerVertex(A[0], A[1])
      }
    } else if (obj.isLineSegments) {
      for (let k = 0; k + 1 < count; k += 2) {
        read(vi(k), A)
        read(vi(k + 1), B)
        considerSegment(A[0], A[1], B[0], B[1])
      }
    } else {
      /* Continuous line strip. */
      for (let k = 0; k + 1 < count; k++) {
        read(vi(k), A)
        read(vi(k + 1), B)
        considerSegment(A[0], A[1], B[0], B[1])
      }
    }
  })

  if (bestVertex) return { x: bestVertex.x, y: bestVertex.y, type: "vertex" }
  if (bestEdge) return { x: bestEdge.x, y: bestEdge.y, type: "edge" }
  return null
}
