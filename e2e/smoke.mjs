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
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['desktop-1440', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    // errors thrown inside embedded third-party frames (the Mesonet dashboard's Leaflet plugin) are not ours
    page.on('pageerror', (e) => { const t = String(e); if (!/reading 'Control'/.test(t)) errors.push(t) })
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    check(`${label}: landing loads`, (await page.locator('h1').first().textContent()) === 'Hawaiʻi Climate Data Portal')   // the sr-only h1 (L1 B: no heading over the map)
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
    // R1 A + D: the reply shows first (700 ms), then the bar rides up (450 ms) and the page changes.
    await page.waitForURL(/\/viewer\//, { timeout: 5000 }).catch(() => {})
    const path = new URL(page.url()).pathname
    const docked = (await page.locator('[data-testid="assistant-bar"] [data-testid="assistant-input"]').count()) > 0
    check(`${label}: navigator answered`, answered, `${ms} ms, now at ${path}`)
    check(`${label}: navigated to the viewer with the bar docked under the header`, path.startsWith('/viewer/') && docked, path)
    check(`${label}: the reply strip repeats the answer under the docked bar`, (await page.locator('[data-testid="reply-strip"]').count()) === 1)
    await page.screenshot({ path: `${OUT}/after-navigate-${label}.png`, fullPage: false })
    if (docked) {
      await page.locator('[data-testid="assistant-bar"] [data-testid="assistant-input"]').focus()
      check(`${label}: focusing the docked bar opens the conversation dropdown`, await page.locator('[data-testid="assistant-dropdown"]').isVisible())
      await page.screenshot({ path: `${OUT}/dropdown-${label}.png` })
      await page.keyboard.press('Escape')
      check(`${label}: Esc closes the dropdown`, (await page.locator('[data-testid="assistant-dropdown"]').count()) === 0)
    }
    // Deep link direct load
    await page.goto(BASE + '/viewer/rainfall/day/2026-09-07/kauai', { waitUntil: 'networkidle' })
    check(`${label}: deep link resolves`, (await page.locator('body').innerText()).includes('Kaua'))
    // Item 17: the whole map — compass, legend, scale bar, zoom control, title card — is on screen unscrolled.
    await page.waitForSelector('.leaflet-container', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const furniture = await page.evaluate(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right } }
      const inside = (b) => Boolean(b) && b.top >= 0 && b.left >= 0 && b.bottom <= window.innerHeight && b.right <= window.innerWidth
      const pieces = { zoom: '.leaflet-control-zoom', compass: '[data-testid="compass-rose"]', legend: '[data-testid="legend"]', scale: '.leaflet-control-scale', title: '[data-testid="viewer-title-card"]', pane: '[data-testid="map-pane"]' }
      return { scrollY: window.scrollY, missing: Object.entries(pieces).filter(([, sel]) => !box(sel)).map(([k]) => k), outside: Object.entries(pieces).filter(([, sel]) => box(sel) && !inside(box(sel))).map(([k]) => k) }
    })
    check(`${label}: whole map visible unscrolled (compass, legend, scale bar, zoom, title)`, furniture.scrollY === 0 && furniture.missing.length === 0 && furniture.outside.length === 0, `missing [${furniture.missing}] outside [${furniture.outside}]`)
    await page.screenshot({ path: `${OUT}/viewer-whole-map-${label}.png` })
    await page.goto(BASE + '/extreme-events', { waitUntil: 'networkidle' })
    check(`${label}: extreme events page`, await page.locator('h1').first().isVisible())
    check(`${label}: original-version bar`, (await page.locator('[data-testid="original-link"]').count()) === 1 && (await page.locator('[data-testid="share-view"]').count()) === 1)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await page.locator('[data-testid="share-view"]').click()
    await page.waitForTimeout(300)
    const shown = await page.locator('[data-testid="share-panel"] input').inputValue().catch(() => '')
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '')
    check(`${label}: share panel shows and copies the link`, shown === page.url() && (clip === page.url() || clip === '') && (await page.locator('[data-testid="share-copy"]').count()) === 1, `${shown.slice(-40)} | clipboard ${clip ? 'ok' : 'n/a'}`)
    await page.goto(BASE + '/extreme-events/lowell', { waitUntil: 'networkidle' })
    check(`${label}: storm route`, (await page.locator('#lowell').count()) === 1 && (await page.locator('[data-testid="original-link"]').getAttribute('href')).includes('hurricane-lowell'))
    // The embedded Mesonet dashboard keeps the network busy, so do not wait for idle here; wait for our station picker instead.
    await page.goto(BASE + '/mesonet?viewer=live&station=0115&view=dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="station-picker"] select', { timeout: 30000 }).catch(() => {})
    check(`${label}: mesonet station link`, (await page.locator('[data-testid="original-link"]').getAttribute('href')).includes('#/dashboard?id=0115') && (await page.locator('[data-testid="station-picker"] select').first().inputValue()) === '0115')
    await page.goto(BASE + '/nope', { waitUntil: 'networkidle' })
    check(`${label}: 404 page`, (await page.locator('body').innerText()).includes('not here'))
    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await page.close()
  }
} finally { await browser.close() }
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`)
process.exit(failed ? 1 : 0)
