/* End-to-end smoke test: upload a DXF, preview it, measure distances
   with snapping off (raw picks) and on (snapped picks). */
import { chromium } from "playwright-core"

const exe =
  process.env.HOME + "/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"
const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text())
})
const fail = (msg) => {
  console.error("FAIL:", msg)
  process.exitCode = 1
}

await page.goto("http://localhost:5199/")
await page
  .locator("input[type=file]")
  .setInputFiles(
    "/home/archit/projects/honeywell/tman/parking_lot_top_view.dxf",
  )
await page.waitForFunction(() => window.__dxfViewer?.GetBounds() != null, null, {
  timeout: 20000,
})
await page.waitForTimeout(600)
await page.screenshot({ path: "/tmp/e2e_2_loaded.png" })

/* Project a model-space point to page coordinates using the ortho camera. */
const modelToPage = async (mx, my) =>
  page.evaluate(
    ([x0, y0]) => {
      const v = window.__dxfViewer
      const cam = v.GetCamera()
      const o = v.GetOrigin()
      const x = x0 - o.x // scene space
      const y = y0 - o.y
      const dx = (cam.right - cam.left) / (2 * cam.zoom)
      const dy = (cam.top - cam.bottom) / (2 * cam.zoom)
      const cx = (cam.right + cam.left) / 2
      const cy = (cam.top + cam.bottom) / 2
      const ndcX = (x - cam.position.x - cx) / dx
      const ndcY = (y - cam.position.y - cy) / dy
      const rect = v.GetCanvas().getBoundingClientRect()
      return {
        x: rect.x + ((ndcX + 1) / 2) * rect.width,
        y: rect.y + ((1 - ndcY) / 2) * rect.height,
      }
    },
    [mx, my],
  )

await page.getByRole("button", { name: /Measure/ }).click()

/* ---- Part 1: snap OFF, displayed distance must match the raw transform -- */
await page.getByRole("button", { name: /Snap/ }).click() // toggle off

const canvas = page.locator("canvas")
const box = await canvas.boundingBox()
const p1 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 }
const p2 = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.45 }

const expected = await page.evaluate(
  ([a, b, bx]) => {
    const v = window.__dxfViewer
    const A = v._CanvasToSceneCoord(a.x - bx.x, a.y - bx.y)
    const B = v._CanvasToSceneCoord(b.x - bx.x, b.y - bx.y)
    return Math.hypot(B.x - A.x, B.y - A.y)
  },
  [p1, p2, box],
)

await page.mouse.click(p1.x, p1.y)
await page.waitForTimeout(120)
await page.mouse.click(p2.x, p2.y)
await page.waitForTimeout(250)

const readout1 = (await page.locator(".readout-main").textContent()).trim()
const shown1 = parseFloat(readout1)
if (Math.abs(shown1 - expected) / expected < 0.01) {
  console.log(`raw measure ok: ${readout1} (expected ${expected.toFixed(3)})`)
} else {
  fail(`raw measure mismatch: shown ${readout1}, expected ${expected.toFixed(3)}`)
}

/* ---- Part 2: snap ON, clicks near corners must snap exactly ------------- */
await page.getByRole("button", { name: "Clear" }).click()
await page.getByRole("button", { name: /Snap/ }).click() // toggle on again

/* Lot boundary corners (0,0) and (0,45) in model space are 45 m apart. */
const c1 = await modelToPage(0, 0)
const c2 = await modelToPage(0, 45)

await page.mouse.move(c1.x + 6, c1.y - 6) // show the snap indicator too
await page.waitForTimeout(100)
await page.mouse.click(c1.x + 6, c1.y - 6)
await page.waitForTimeout(120)
await page.mouse.click(c2.x + 6, c2.y + 6)
await page.waitForTimeout(250)

const m = await page.evaluate(() => {
  const list = window.__measurements ?? []
  const last = list[list.length - 1]
  return last
    ? { a: last.a, b: last.b, distance: last.distance, origin: {
        x: window.__dxfViewer.GetOrigin().x, y: window.__dxfViewer.GetOrigin().y } }
    : null
})
const readout2 = (await page.locator(".readout-main").textContent()).trim()
await page.screenshot({ path: "/tmp/e2e_4_snapped.png" })

if (!m) {
  fail("no snapped measurement recorded")
} else {
  /* Scene-space expectations: model (0,0) -> (-origin.x, -origin.y). */
  const exp1 = { x: -m.origin.x, y: -m.origin.y }
  const exp2 = { x: -m.origin.x, y: 45 - m.origin.y }
  const eps = 1e-4
  const close = (p, q) =>
    Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps
  if (!close(m.a, exp1)) fail(`point A not snapped: ${JSON.stringify(m.a)} vs ${JSON.stringify(exp1)}`)
  if (!close(m.b, exp2)) fail(`point B not snapped: ${JSON.stringify(m.b)} vs ${JSON.stringify(exp2)}`)
  if (Math.abs(m.distance - 45) > 1e-3) fail(`snapped distance ${m.distance}, expected 45`)
  if (!readout2.startsWith("45.00")) fail(`readout "${readout2}", expected 45.00`)
  if (process.exitCode !== 1) {
    console.log(`snap measure ok: ${readout2} (clicked 6px off both corners, got exact 45.000)`)
  }
}

/* ---- Part 3: 3D file is flattened to XY ---------------------------------- */
if (await page.locator(".banner.info").isVisible().catch(() => false)) {
  fail("3D banner shown for a 2D file")
}

await page
  .locator("input[type=file]")
  .setInputFiles("/home/archit/projects/honeywell/tman/test_3d.dxf")
await page.waitForFunction(
  () => window.__dxfViewer?.GetBounds()?.maxX === 20,
  null,
  { timeout: 20000 },
)
await page.waitForTimeout(500)

if (!(await page.locator(".banner.info").isVisible().catch(() => false))) {
  fail("3D banner not shown for a 3D file")
} else {
  console.log("3D banner ok")
}

/* Measure the sloped line (2,4,0)->(12,4,-3): 3D length is 10.44, but the
   flattened XY distance must be exactly 10. Measure mode and snap are still
   on from part 2. */
const s1 = await modelToPage(2, 4)
const s2 = await modelToPage(12, 4)
await page.mouse.click(s1.x + 7, s1.y - 5)
await page.waitForTimeout(120)
await page.mouse.click(s2.x - 7, s2.y + 5)
await page.waitForTimeout(250)

const m3 = await page.evaluate(() => {
  const list = window.__measurements ?? []
  return list[list.length - 1] ?? null
})
await page.screenshot({ path: "/tmp/e2e_5_3d_flat.png" })
if (!m3) {
  fail("no measurement on the 3D file")
} else if (Math.abs(m3.distance - 10) > 1e-3) {
  fail(`3D line measured ${m3.distance}, expected flattened 10.000`)
} else {
  console.log(
    `3D flatten ok: sloped line measured ${m3.distance.toFixed(4)} (XY projection, not 10.44)`,
  )
}

if (errors.length) fail("page errors: " + JSON.stringify(errors))
else console.log("page errors: none")

await browser.close()
if (process.exitCode !== 1) console.log("ALL PASS")
