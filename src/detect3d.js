/* Detect whether a parsed DXF document contains 3D geometry (any nonzero
   Z coordinate or elevation). The viewer always projects onto the XY plane;
   this check only decides whether to tell the user that flattening happened.

   `extrusionDirection` is excluded: (0,0,1) is the normal 2D case, and a
   negative Z there means a mirrored 2D entity, not 3D content. */

const SKIP_KEYS = new Set(["extrusionDirection", "normal", "normalVector"])
const EPS = 1e-9

function hasZ(value, depth, seen) {
  if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) {
    return false
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.some((v) => hasZ(v, depth + 1, seen))
  }
  for (const [key, v] of Object.entries(value)) {
    if (SKIP_KEYS.has(key)) continue
    if (
      (key === "z" || key === "elevation") &&
      typeof v === "number" &&
      Math.abs(v) > EPS
    ) {
      return true
    }
    if (typeof v === "object" && hasZ(v, depth + 1, seen)) return true
  }
  return false
}

export function detect3D(dxf) {
  if (!dxf) return false
  const seen = new Set()
  if ((dxf.entities ?? []).some((e) => hasZ(e, 0, seen))) return true
  return Object.values(dxf.blocks ?? {}).some((block) =>
    (block.entities ?? []).some((e) => hasZ(e, 0, seen)),
  )
}
