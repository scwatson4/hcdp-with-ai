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
    // The mirror's picture proxy sends a picture it has not cached yet to HCDP's own file; the smoke never pulls those
    // (every fetch of www.hawaii.edu stays the mirror job's, one at a time, 3 s apart).
    let notCached = 0
    await page.route('**/api/portal/img**', async (route) => {
      const resp = await route.fetch({ maxRedirects: 0 }).catch(() => null)
      if (!resp || (resp.status() >= 300 && resp.status() < 400)) { notCached += 1; return route.abort() }
      return route.fulfill({ response: resp })
    })
    const errors = []
    // errors thrown inside embedded third-party frames (the Mesonet dashboard's Leaflet plugin) are not ours
    page.on('pageerror', (e) => { const t = String(e); if (!/reading 'Control'/.test(t)) errors.push(t) })
    const shadowInfo = () => page.evaluate(() => {
      const sr = document.querySelector('[data-testid="mirror-host"]')?.shadowRoot
      return sr ? { text: sr.querySelector('.entry-content')?.textContent || '', sheets: sr.adoptedStyleSheets?.length || sr.querySelectorAll('style').length, html: sr.innerHTML } : null
    })
    const mirrorReady = () => page.waitForFunction(() => document.querySelector('[data-testid="mirror-host"]')?.shadowRoot?.querySelector('.entry-content'), null, { timeout: 20000 }).then(() => true).catch(() => false)
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
    // R6 C (13 Oct): the staged wait line — "Thinking…" at once, "Finding the right page…" after 1.4 s, then
    // "Opening {destination}…" (the server-resolved title) for the hold and the travel; no gpt-6-luna narration.
    await page.waitForSelector('[data-testid="landing-status"]', { state: 'attached', timeout: 5000 }).catch(() => {})
    const firstLine = await page.evaluate(() => document.querySelector('[data-testid="landing-status"]')?.textContent || '')
    const answered = await page.waitForFunction(() => { const el = document.querySelector('[data-testid="landing-status"]'); return !el || /^Opening /.test(el.textContent || '') }, null, { timeout: 90000 }).then(() => true).catch(() => false)
    const ms = Date.now() - t0
    const openingLine = await page.evaluate(() => document.querySelector('[data-testid="landing-status"]')?.textContent || '')
    check(`${label}: the wait line is staged (Thinking… first, then Opening {destination}…)`, firstLine === 'Thinking…' && /^Opening .+…$/.test(openingLine), `"${firstLine}" → "${openingLine}"`)
    // R1 A + D: the line holds (700 ms), then the bar rides up (450 ms) and the page changes.
    await page.waitForURL(/\/viewer\//, { timeout: 5000 }).catch(() => {})
    const path = new URL(page.url()).pathname
    const phone = viewport.width < 768
    const docked = (await page.locator('[data-testid="assistant-bar"] [data-testid="assistant-input"]').count()) > 0
    // M1 C (14 Oct): on a phone the viewer is a full-screen map — no docked bar; its Ask AI is the pill in the floating bar
    const fab = await page.waitForSelector('[data-testid="viewer-fab"] [data-testid="fab-ask"]', { timeout: phone ? 5000 : 1 }).then(() => true).catch(() => false)
    check(`${label}: navigator answered`, answered, `${ms} ms, now at ${path}`)
    if (phone) check(`${label}: navigated to the viewer, a full-screen map with its floating bar (Controls · Share · Ask AI)`, path.startsWith('/viewer/') && fab && !docked, path)
    else check(`${label}: navigated to the viewer with the bar docked under the header`, path.startsWith('/viewer/') && docked, path)
    // 13 Oct: the destination opens with the AI overview (header "AI Overview", "Generated by HCDP AI", the HCDP sources first,
    // the sentences); the reply strip shows only when the overview failed. Wait for the overview to be written (≤ 6 s + travel).
    const overview = await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="ai-summary"]')
      return (el && el.dataset.status === 'ready') || !!document.querySelector('[data-testid="reply-strip"]')
    }, null, { timeout: 15000 }).then(() => page.evaluate(() => {
      const el = document.querySelector('[data-testid="ai-summary"]')
      if (!el) return { ready: false, strip: !!document.querySelector('[data-testid="reply-strip"]') }
      const q = (sel) => el.querySelector(sel)
      return {
        ready: el.dataset.status === 'ready', strip: !!document.querySelector('[data-testid="reply-strip"]'),
        title: q('[data-testid="ai-overview-title"]')?.textContent, eyebrow: q('[data-testid="ai-summary-eyebrow"]')?.textContent,
        sources: [...el.querySelectorAll('[data-testid="ai-summary-sources"] a')].map((a) => a.getAttribute('href')),
        chunks: [...el.querySelectorAll('[data-testid="ai-summary-chunk"]')].length,
        sourcesFirst: (() => { const s = q('[data-testid="ai-summary-sources"]'); const t = q('[data-testid="ai-summary-text"]'); return !!(s && t && (s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) })(),
        followupGhost: document.querySelector('[data-testid="assistant-bar"] [data-testid="composer-ghost"]')?.dataset.pool,
      }
    })).catch(() => ({ ready: false, strip: false, timeout: true }))
    if (overview.ready) {
      check(`${label}: the AI overview opens the destination (header, sources first, sentences) and no reply strip`, overview.title === 'AI Overview' && /Generated by HCDP AI/.test(overview.eyebrow || '') && overview.sources.length >= 1 && overview.sources.every((h) => /^https:\/\//.test(h)) && overview.sourcesFirst && overview.chunks >= 2 && !overview.strip, `${overview.chunks} sentences, sources ${overview.sources.length}, ghost ${overview.followupGhost || 'none'}`)
    } else {
      check(`${label}: the reply strip repeats the answer under the docked bar (no overview came)`, overview.strip, overview.timeout ? 'neither arrived in 15 s' : 'overview empty')
    }
    await page.screenshot({ path: `${OUT}/after-navigate-${label}.png`, fullPage: false })
    if (docked) {
      await page.locator('[data-testid="assistant-bar"] [data-testid="assistant-input"]').focus()
      await page.waitForTimeout(300)
      check(`${label}: focusing the docked bar shows no history (no dropdown)`, (await page.locator('[data-testid="assistant-dropdown"]').count()) === 0)   // 12 Oct: never the history on a click
      await page.screenshot({ path: `${OUT}/docked-focus-${label}.png` })
    }
    // Deep link direct load
    await page.goto(BASE + '/viewer/rainfall/day/2026-09-07/kauai', { waitUntil: 'networkidle' })
    check(`${label}: deep link resolves`, (await page.locator('body').innerText()).includes('Kaua'))
    // Item 17: the whole map — compass, legend, scale bar, zoom control, title card — is on screen unscrolled. M1 C (14 Oct): on
    // phones the viewer is a full-screen map with no compass, and the reading chips carry the title (no title card).
    await page.waitForSelector('.leaflet-container', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const phoneMap = label === 'phone'
    const furniture = await page.evaluate((phone) => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right } }
      const inside = (b) => Boolean(b) && b.top >= 0 && b.left >= 0 && b.bottom <= window.innerHeight && b.right <= window.innerWidth
      // M1 C: a phone shows the reading chips (they carry the title) and the floating bar instead of the title card and the compass
      const pieces = phone
        ? { zoom: '.leaflet-control-zoom', legend: '[data-testid="legend"]', scale: '.leaflet-control-scale', chips: '[data-testid="reading-chips"]', bar: '[data-testid="viewer-fab"]', pane: '[data-testid="map-pane"]' }
        : { zoom: '.leaflet-control-zoom', compass: '[data-testid="compass-rose"]', legend: '[data-testid="legend"]', scale: '.leaflet-control-scale', title: '[data-testid="viewer-title-card"]', pane: '[data-testid="map-pane"]' }
      return { scrollY: window.scrollY, scrolls: document.documentElement.scrollHeight > window.innerHeight + 1, missing: Object.entries(pieces).filter(([, sel]) => !box(sel)).map(([k]) => k), outside: Object.entries(pieces).filter(([, sel]) => box(sel) && !inside(box(sel))).map(([k]) => k) }
    }, phoneMap)
    check(`${label}: whole map visible unscrolled (${phoneMap ? 'chips, floating bar, legend strip, scale bar, zoom; the page never scrolls' : 'compass, legend, scale bar, zoom, title'})`, furniture.scrollY === 0 && furniture.missing.length === 0 && furniture.outside.length === 0 && (!phoneMap || !furniture.scrolls), `missing [${furniture.missing}] outside [${furniture.outside}]`)
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
    // 14 Oct: the storm reports are HCDP's apps, embedded full height under the header (the old sections are gone).
    await page.goto(BASE + '/extreme-events/lowell', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="embed-frame"]', { timeout: 20000 }).catch(() => {})
    check(`${label}: storm route (the report embedded, the strip, the original link)`, ((await page.locator('[data-testid="embed-frame"]').getAttribute('src').catch(() => '')) || '').endsWith('#/hurricane-lowell')
      && (await page.locator('[data-testid="embed-strip"] h1').textContent().catch(() => '')) === 'Hurricane Lowell'
      && (await page.locator('[data-testid="original-link"]').getAttribute('href')).includes('hurricane-lowell'))
    // The embedded Mesonet dashboard keeps the network busy, so do not wait for idle; the station is in the app's address.
    await page.goto(BASE + '/mesonet?viewer=live&station=0115&view=dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="embed-frame"]', { timeout: 30000 }).catch(() => {})
    check(`${label}: mesonet station link`, (await page.locator('[data-testid="original-link"]').getAttribute('href')).includes('#/dashboard?id=0115')
      && ((await page.locator('[data-testid="embed-frame"]').getAttribute('src').catch(() => '')) || '').includes('#/dashboard?id=0115'))
    // The mirrored HCDP pages (CONTRACT.md "Mirrored pages"): HCDP's copy inside a shadow root, the band, one h1, the menu.
    await page.goto(BASE + '/extreme-events', { waitUntil: 'domcontentloaded' })
    const eeReady = await mirrorReady()
    const ee = await shadowInfo()
    const cards = ee ? [...ee.html.matchAll(/href="\/extreme-events\/([a-z0-9-]+)"/g)].map((m) => m[1]) : []
    check(`${label}: Extreme Events is HCDP's page (band, five cards, Nolo first)`, eeReady && (await page.locator('[data-testid="mirror-band"]').textContent()) === 'Extreme Events'
      && JSON.stringify(cards) === JSON.stringify(['nolo', 'lowell', 'lala', 'kona-low-2', 'kona-low-1']), cards.join(','))
    await page.goto(BASE + '/tools', { waitUntil: 'domcontentloaded' })
    await mirrorReady()
    const tools = await shadowInfo()
    const tiles = tools ? (tools.html.match(/border-radius: 10px/g) || []).length : 0
    check(`${label}: Climate Tools shows HCDP's 12 tiles incl. the two VMAP ones`, tiles === 12 && /VMAP Vog Forecast Dashboard/.test(tools.text) && /VMAP Fire Weather Dashboard/.test(tools.text), `${tiles} tiles`)
    await page.goto(BASE + '/about/team', { waitUntil: 'domcontentloaded' })
    await mirrorReady()
    const team = await shadowInfo()
    check(`${label}: Team is HCDP's page in a shadow root with its theme`, Boolean(team && /Ryan Longman/.test(team.text) && team.sheets >= 3) && (await page.title()) === 'Team – Hawaiʻi Climate Data Portal'
      && (await page.locator('h1').count()) === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.screenshot({ path: `${OUT}/mirror-team-${label}.png`, fullPage: true })
    await page.goto(BASE + '/library', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="library-item"]', { timeout: 20000 }).catch(() => {})
    check(`${label}: Library lists the Zotero group by year`, (await page.locator('[data-testid="library-item"]').count()) > 500 && (await page.locator('[data-testid="mirror-band"]').textContent()) === 'Publications List')
    await page.goto(BASE + '/research/posts/a-century-of-drought-in-hawaii', { waitUntil: 'domcontentloaded' })
    await mirrorReady()
    const post = await shadowInfo()
    check(`${label}: a research post (title, date, no byline)`, Boolean(post && /A Century of Drought/.test(post.html) && /Posted on/.test(post.html) && !/byline/.test(post.html)))
    if (notCached) console.log(`  (${notCached} pictures not cached yet on ${label}: not fetched from HCDP by the smoke)`)
    await page.goto(BASE + '/nope', { waitUntil: 'networkidle' })
    check(`${label}: 404 page`, (await page.locator('body').innerText()).includes('not here'))
    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await page.close()
  }
} finally { await browser.close() }
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`)
process.exit(failed ? 1 : 0)
