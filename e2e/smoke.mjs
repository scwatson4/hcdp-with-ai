// End-to-end smoke test of the built site served by the backend.
// Usage: node e2e/smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from '/tmp/smokedir/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://127.0.0.1:8010'
const OUT = process.argv[3] || '/tmp/claude-1001/-home-exouser/064baeac-7523-4d99-8946-e07207afc920/scratchpad/e2e'
fs.mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

const browser = await chromium.launch()
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    check(`${label}: landing loads`, await page.locator('h1').first().isVisible())
    check(`${label}: six tool cards`, (await page.locator('[data-testid^="tool-"]').count()) === 6)
    check(`${label}: assistant box present`, await page.locator('[data-testid="landing-assistant"]').isVisible())
    check(`${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.screenshot({ path: `${OUT}/landing-${label}.png`, fullPage: true })

    // Ask a navigation question; expect a reply and, if it navigated, the dock.
    const input = page.locator('[data-testid="assistant-input"]')
    await input.fill('Show me the rainfall map for Kauaʻi on 7 September 2026')
    await input.press('Enter')
    const t0 = Date.now()
    await page.waitForSelector('[data-testid="assistant-busy"]', { state: 'attached', timeout: 5000 }).catch(() => {})
    const answered = await page.waitForFunction(() => !document.querySelector('[data-testid="assistant-busy"]'), null, { timeout: 90000 }).then(() => true).catch(() => false)
    const ms = Date.now() - t0
    const path = new URL(page.url()).pathname
    const docked = (await page.locator('[data-testid="assistant-dock"], [data-testid="assistant-dock-panel"]').count()) > 0
    check(`${label}: navigator answered`, answered, `${ms} ms, now at ${path}`)
    check(`${label}: navigated to the viewer and minimized`, path.startsWith('/viewer/') && docked, path)
    await page.screenshot({ path: `${OUT}/after-navigate-${label}.png`, fullPage: false })
    if (docked) {
      await page.locator('[data-testid="assistant-dock"]').click().catch(() => {})
      check(`${label}: dock expands to a panel`, await page.locator('[data-testid="assistant-dock-panel"]').isVisible())
      await page.screenshot({ path: `${OUT}/dock-panel-${label}.png` })
    }
    // Deep link direct load
    await page.goto(BASE + '/viewer/rainfall/day/2026-09-07/kauai', { waitUntil: 'networkidle' })
    check(`${label}: deep link resolves`, (await page.locator('body').innerText()).includes('Kaua'))
    await page.goto(BASE + '/extreme-events', { waitUntil: 'networkidle' })
    check(`${label}: extreme events page`, await page.locator('h1').first().isVisible())
    await page.goto(BASE + '/nope', { waitUntil: 'networkidle' })
    check(`${label}: 404 page`, (await page.locator('body').innerText()).includes('not here'))
    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await page.close()
  }
} finally { await browser.close() }
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`)
process.exit(failed ? 1 : 0)
