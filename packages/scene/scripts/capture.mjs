/**
 * Screenshot the workbench for visual review.
 *
 * Start the dev server first (`npm run dev`), then:
 *   node scripts/capture.mjs [outDir]
 *
 * Uses the container's pre-installed Chromium rather than downloading one;
 * PLAYWRIGHT_CHROMIUM overrides the path if yours lives elsewhere.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'shots'
const url = process.env.WORKBENCH_URL ?? 'http://127.0.0.1:5173/'
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const SHOTS = [
  { name: 'hill-climber', surface: 'Himmelblau', algorithm: 'hill climber', settle: 5000 },
  { name: 'gradient-ascent', surface: 'Schwefel', algorithm: 'gradient ascent', gradients: true },
  { name: 'annealing', surface: 'Eggholder', algorithm: 'simulated annealing', settle: 8000 },
  { name: 'genetic', surface: 'Ackley', algorithm: 'genetic algorithm', settle: 7000 },
]

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({
  viewport: { width: 1400, height: 820 },
  deviceScaleFactor: 1.5,
})

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('canvas', { timeout: 30000 })

for (const shot of SHOTS) {
  await page.locator('select').nth(0).selectOption(shot.surface)
  await page.locator('select').nth(1).selectOption(shot.algorithm)
  await page.locator('input[type=checkbox]').nth(0).setChecked(Boolean(shot.gradients))
  await page.getByRole('button', { name: 'Restart' }).click()
  await page.waitForTimeout(shot.settle ?? 5000)
  await page.screenshot({ path: `${outDir}/${shot.name}.png` })
  console.log(`captured ${shot.name}`)
}

await browser.close()

if (errors.length) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log('no page errors')
