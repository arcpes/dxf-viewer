/* Re-project an ASCII DXF onto a different plane by remapping coordinate
   group codes before the viewer parses the file:

     top   — (x, y, z) -> (x, y)   original text, untouched
     front — (x, y, z) -> (x, z)   looking along -Y
     side  — (x, y, z) -> (y, z)   looking along -X

   Point coordinates are grouped as code triples (1N = x, 2N = y, 3N = z,
   N = 0..7); LWPOLYLINE's shared elevation (38) supplies z for its 2D
   vertices. Z tags, elevation, thickness (39) and extrusion direction
   (210/220/230) are dropped from the output.

   This is an "ignore one axis" projection: straight geometry (lines,
   polylines, meshes, faces) projects exactly; curved planar entities
   (circles, arcs, text) are repositioned by their anchor point but keep
   their shape rather than becoming ellipses. */

/* Z (30..37), elevation (38), thickness (39), extrusion (210/220/230). */
const DROP_CODES = new Set([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 210, 220, 230])

function transformEntityTags(tags, axis) {
  let elevation = 0
  for (const t of tags) {
    if (t.code === 38) elevation = parseFloat(t.value) || 0
  }
  const out = []
  const consumed = new Set()
  for (let i = 0; i < tags.length; i++) {
    if (consumed.has(i)) continue
    const { code, codeRaw, value } = tags[i]
    if (DROP_CODES.has(code)) continue
    if (code >= 10 && code <= 17) {
      const yCode = code + 10
      const zCode = code + 20
      /* The matching y/z tags follow before the next x-code starts a
         new point (relevant for repeating groups, e.g. SPLINE fit points). */
      let yIdx = -1
      let zIdx = -1
      for (let j = i + 1; j < tags.length; j++) {
        const c = tags[j].code
        if (c >= 10 && c <= 17) break
        if (c === yCode && yIdx < 0) yIdx = j
        else if (c === zCode && zIdx < 0) zIdx = j
        if (yIdx >= 0 && zIdx >= 0) break
      }
      const x = parseFloat(value) || 0
      const y = yIdx >= 0 ? parseFloat(tags[yIdx].value) || 0 : 0
      const z = zIdx >= 0 ? parseFloat(tags[zIdx].value) || 0 : elevation
      const nx = axis === "front" ? x : y
      const ny = z
      out.push({ codeRaw, value: String(nx) })
      if (yIdx >= 0) {
        out.push({ codeRaw: tags[yIdx].codeRaw, value: String(ny) })
        consumed.add(yIdx)
      }
      if (zIdx >= 0) consumed.add(zIdx)
      continue
    }
    out.push({ codeRaw, value })
  }
  return out
}

export function flattenDxf(text, axis) {
  if (axis === "top") return text
  if (text.startsWith("AutoCAD Binary DXF")) return text // cannot transform

  const lines = text.split(/\r\n|\r|\n/)
  const tags = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    tags.push({
      code: parseInt(lines[i], 10),
      codeRaw: lines[i],
      value: lines[i + 1],
    })
  }

  const out = []
  let section = null
  let i = 0
  while (i < tags.length) {
    const tag = tags[i]
    const val = tag.value.trim()
    if (tag.code === 0 && val === "SECTION") {
      section = tags[i + 1]?.code === 2 ? tags[i + 1].value.trim() : null
      out.push(tag)
      i++
      continue
    }
    if (tag.code === 0 && val === "ENDSEC") {
      section = null
      out.push(tag)
      i++
      continue
    }
    if ((section === "ENTITIES" || section === "BLOCKS") && tag.code === 0) {
      let j = i + 1
      while (j < tags.length && tags[j].code !== 0) j++
      out.push(tag)
      out.push(...transformEntityTags(tags.slice(i + 1, j), axis))
      i = j
      continue
    }
    out.push(tag)
    i++
  }
  return out.map((t) => t.codeRaw + "\r\n" + t.value).join("\r\n") + "\r\n"
}
