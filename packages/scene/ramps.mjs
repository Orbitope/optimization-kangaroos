import { chromium } from 'playwright'
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await b.newPage({ viewport: { width: 760, height: 620 }, deviceScaleFactor: 1.4 })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'load' })
await p.waitForSelector('canvas', { timeout: 30000 })

const sel = (label) => p.locator('label', { hasText: label }).locator('select')
const rng = (label) => p.locator('label', { hasText: label }).locator('input[type=range]')

await p.locator('select').nth(0).selectOption('Truth (Act 4)')
await p.locator('select').nth(2).selectOption('gradient ascent')
await p.waitForTimeout(2500)

for (const r of ['hypsometric', 'ember', 'steel', 'ash', 'viridis']) {
  await sel('Colour ramp').selectOption(r)
  await p.waitForTimeout(2500)
  await p.locator('.stage').screenshot({ path: `/tmp/ramp-${r}.png` })
}

// Data-shift overlay: 5 draws of 15 examples, over the truth.
await sel('Colour ramp').selectOption('ash')
await p.locator('select').nth(0).selectOption('Data (Act 4)')
await p.waitForTimeout(1200)
await rng('Examples').fill('15')
await rng('Data-shift overlay').fill('5')
await p.waitForTimeout(4000)
await p.locator('.stage').screenshot({ path: '/tmp/overlay-15.png' })

await rng('Examples').fill('400')
await p.waitForTimeout(4000)
await p.locator('.stage').screenshot({ path: '/tmp/overlay-400.png' })

console.log('errors:', errs.slice(0, 4))
await b.close()
