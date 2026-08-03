import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 780, height: 640 }, deviceScaleFactor: 1.4 })
const e=[]; p.on('pageerror', x=>e.push(x.message))
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'load' })
await p.waitForSelector('canvas', { timeout: 30000 })
const rng = (l) => p.locator('label', { hasText: l }).locator('input[type=range]')
await p.locator('select').nth(0).selectOption('Data (Act 4)')
await p.locator('select').nth(2).selectOption('gradient ascent')
await p.waitForTimeout(1200)
for (const [tag, n] of [['15', 15], ['400', 400]]) {
  await rng('Examples').fill(String(n))
  await rng('Data-shift overlay').fill('5')
  await p.waitForTimeout(4000)
  await p.locator('.stage').screenshot({ path: `/tmp/ov2-${tag}.png` })
}
console.log('errors:', e.slice(0,3)); await b.close()
