/**
 * Renders the promo film frame by frame.
 *
 * The animation is driven by a deterministic seek() rather than CSS timing, so
 * every frame is exact and the motion has no judder — which a screen recording
 * of a CSS animation cannot promise.
 *
 *   FPS=60 DUR=60 node scripts/render-promo.mjs
 *   ffmpeg -framerate 60 -i .promo/frames/f%05d.jpg -c:v libx264 -preset slow \
 *     -crf 18 -pix_fmt yuv420p -movflags +faststart -r 60 -y out.mp4
 *
 * 3600 frames take about three minutes and 460 MB of scratch space.
 */
import { chromium } from "playwright"
import { mkdirSync, rmSync } from "node:fs"

const FPS = Number(process.env.FPS ?? 60)
const DUR = Number(process.env.DUR ?? 60)
const total = FPS * DUR
rmSync(".promo/frames", { recursive: true, force: true })
mkdirSync(".promo/frames", { recursive: true })

const b = await chromium.launch(["--force-color-profile=srgb"])
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await p.goto(`file://${process.cwd()}/scripts/promo-source.html`, { waitUntil: "networkidle" })
await p.waitForTimeout(900)

const t0 = Date.now()
for (let i = 0; i < total; i++) {
  await p.evaluate((t) => window.seek(t), i / FPS)
  await p.screenshot({
    path: `.promo/frames/f${String(i).padStart(5, "0")}.jpg`,
    type: "jpeg",
    quality: 96,
  })
  if (i % 300 === 0 && i) {
    const el = (Date.now() - t0) / 1000
    console.log(`${i}/${total}  ${el.toFixed(0)}s elapsed, ~${((el / i) * (total - i)).toFixed(0)}s left`)
  }
}
await b.close()
console.log(`rendered ${total} frames at ${FPS}fps`)
