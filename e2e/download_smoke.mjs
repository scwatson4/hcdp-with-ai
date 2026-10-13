// The AI-prepared download, end to end in a browser (13 Oct): the landing ask → /data/api with the offer card and the
// API-key line → the drawer with the plain-English reading, the verify ticks and the counts → the Access Data AI line
// pre-ticking the Export form → Visualize opening the viewer → the /download page re-opening the list. It never runs a
// real prepare (no key); backend/tests/test_download_e2e.py covers the real HCDP path.
// Usage: node e2e/download_smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from '/tmp/smokedir/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = (process.argv[2] || 'http://127.0.0.1:8010').replace(/\/+$/, '')
const OUT = process.argv[3] || '/tmp/claude-1001/-home-exouser/064baeac-7523-4d99-8946-e07207afc920/scratchpad/download_smoke'
fs.mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const API_URL = 'https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/'
const ASK = 'How do I download Hurricane Lowell rainfall data?'

const browser = await chromium.launch()
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

  // 1. the landing ask → /data/api with the offer card
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const input = page.locator('[data-testid="assistant-input"]')
  await input.fill(ASK)
  await input.press('Enter')
  const t0 = Date.now()
  await page.waitForURL(/\/data\/api/, { timeout: 90000 }).catch(() => {})
  const navMs = Date.now() - t0
  const path = new URL(page.url()).pathname
  check('landing ask lands on /data/api', path === '/data/api', `${navMs} ms, now at ${path}`)
  const offer = page.locator('[data-testid="download-offer"]')
  const offerShown = await offer.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  check('offer card present at the top of the API page', offerShown)
  if (offerShown) {
    const sentence = await page.locator('[data-testid="offer-sentence"]').textContent()
    const button = await page.locator('[data-testid="offer-button"]').textContent()
    const keyLine = (await page.locator('[data-testid="offer-key-line"]').textContent()).replace(/\s*\(opens in a new tab\)/, '').trim()
    const keyHref = await page.locator('[data-testid="offer-key-link"]').getAttribute('href')
    console.log(`   offer sentence: ${sentence}`)
    check('offer button text', button.trim() === 'Use AI to download the data I need', button.trim())
    check('API-key line text', keyLine === 'Requires HCDP API key. Request one here', keyLine)
    check('API-key link href is the catalog\'s API page', keyHref === API_URL, keyHref)
    // the card sits above the page heading
    const above = await page.evaluate(() => { const c = document.querySelector('[data-testid="download-offer"]'); const h = document.querySelector('main h1'); return !!(c && h && (c.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)) })
    check('offer card is above the heading', above)
    await page.screenshot({ path: `${OUT}/01-offer-card.png`, fullPage: false })

    // 2. the drawer: the reading, the verify ticks, the counts
    await page.locator('[data-testid="offer-button"]').click()
    const drawer = page.locator('[data-testid="download-drawer"]')
    await drawer.waitFor({ state: 'visible', timeout: 10000 })
    const t1 = Date.now()
    const planned = await page.locator('[data-testid="download-reading"]').waitFor({ state: 'visible', timeout: 70000 }).then(() => true).catch(() => false)
    const planMs = Date.now() - t1
    check('drawer planned (reading shown)', planned, `${planMs} ms`)
    if (planned) {
      const reading = await page.locator('[data-testid="download-reading"]').textContent()
      console.log(`   reading: ${reading}`)
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="download-item"]')].every((r) => r.dataset.verify !== 'pending'), null, { timeout: 10000 }).catch(() => {})
      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="download-item"]')].map((r) => ({
        id: r.dataset.itemId, group: r.dataset.group, verify: r.dataset.verify, ticked: r.querySelector('input').checked,
        label: r.querySelector('[data-testid="download-item-label"]')?.textContent?.trim(), why: r.querySelector('[data-testid="download-item-why"]')?.textContent?.trim(),
        count: r.querySelector('[data-testid="download-item-count"]')?.textContent?.trim().replace(/\s+/g, ' ') || null, note: r.querySelector('[data-testid="download-item-note"]')?.textContent?.trim() || null,
      })))
      for (const r of rows) console.log(`   ${r.ticked ? '[x]' : '[ ]'} ${r.verify.padEnd(10)} ${r.group.padEnd(7)} ${r.label} — ${r.why} ${r.count ? `(${r.count})` : ''}${r.note ? ` · ${r.note}` : ''}`)
      const groups = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="download-group-"] legend')].map((l) => l.textContent))
      const totals = await page.locator('[data-testid="download-totals"]').textContent()
      const address = await page.locator('[data-testid="download-address"]').textContent()
      console.log(`   groups: ${groups.join(' · ')}\n   totals: ${totals.trim()}\n   address: ${address}`)
      check('rows verified (check marks, none pending)', rows.length > 0 && rows.every((r) => r.verify === 'ok' || r.verify === 'partial'), rows.map((r) => r.verify).join(','))
      check('reading is one plain paragraph without the old chips line', !/AI read this as .*·/.test(reading) && reading.split(/\s+/).length >= 30, `${reading.split(/\s+/).length} words`)
      check('first picks ticked, context unticked', rows.some((r) => r.ticked) && rows.some((r) => !r.ticked))
      check('counts and size shown', /\d+ files? · about [\d.,]+ (KB|MB|GB)\./.test(totals))
      check('key field is a password field and Download is disabled without it', (await page.locator('[data-testid="download-key"]').getAttribute('type')) === 'password' && (await page.locator('[data-testid="download-now"], [data-testid="download-email-me"]').first().isDisabled()))
      check('something-else row present', (await page.locator('[data-testid="download-something-else"]').count()) === 1)
      await page.screenshot({ path: `${OUT}/02-drawer.png`, fullPage: false })
      // 4 (prepared here): the package address re-opens the list on /download with the same ticks
      const addrPath = address.replace(/^https?:\/\/[^/]+/, '')
      await page.keyboard.press('Escape')
      await page.goto(BASE + addrPath, { waitUntil: 'domcontentloaded' })
      const reopened = await page.locator('[data-testid="download-reading"]').waitFor({ state: 'visible', timeout: 70000 }).then(() => true).catch(() => false)
      check('/download?ask&picks re-opens the list', reopened && (await page.locator('h1').first().textContent()) === 'AI-prepared download')
      if (reopened) {
        const picks = new URL(page.url()).searchParams.get('picks')?.split(',') || []
        const ticked = await page.evaluate(() => [...document.querySelectorAll('[data-testid="download-item"]')].filter((r) => r.querySelector('input').checked).map((r) => r.dataset.itemId))
        check('the address\'s picks are the ticked items', picks.length > 0 && ticked.every((id) => picks.includes(id)), `picks ${picks.length}, ticked ${ticked.length}`)
        await page.screenshot({ path: `${OUT}/04-download-page.png`, fullPage: false })
      }
    }
  }

  // 3. the Access Data line pre-ticks the Export form; Visualize opens the viewer
  await page.goto(BASE + '/data', { waitUntil: 'networkidle' })
  const line = page.locator('[data-testid="access-ai-line"]')
  check('Access Data AI line present at the top', await line.isVisible() && (await page.locator('[data-testid="access-ai-input"]').getAttribute('placeholder')) === 'Tell me what the data is for and I will tick it')
  await page.locator('[data-testid="access-ai-input"]').fill('download the station data for Maui in August')
  await page.locator('[data-testid="access-ai-prepare"]').click()
  const t2 = Date.now()
  const lined = await page.locator('[data-testid="access-ai-reading"]').waitFor({ state: 'visible', timeout: 70000 }).then(() => true).catch(() => false)
  check('Access Data line planned', lined, `${Date.now() - t2} ms`)
  if (lined) {
    console.log(`   reading: ${await page.locator('[data-testid="access-ai-reading"]').textContent()}`)
    await page.waitForTimeout(300)
    const form = await page.evaluate(() => ({
      dataset: document.querySelector('[data-testid="export-dataset"]')?.value,
      period: [...document.querySelectorAll('[data-testid="export-period"] input')].find((i) => i.checked)?.value,
      start: document.querySelector('[data-testid="export-start"]')?.value, end: document.querySelector('[data-testid="export-end"]')?.value,
      extents: [...document.querySelectorAll('[data-testid^="export-extent-"]')].filter((i) => i.checked).map((i) => i.dataset.testid.replace('export-extent-', '')),
      files: [...document.querySelectorAll('[data-testid^="export-file-"]')].filter((i) => i.checked).map((i) => i.dataset.testid.replace('export-file-', '')),
      stations: [...document.querySelectorAll('[data-testid^="export-station-"]')].filter((i) => i.checked).map((i) => i.dataset.testid.replace('export-station-', '')),
      estimate: document.querySelector('[data-testid="export-estimate"]')?.textContent?.trim(),
    }))
    console.log(`   export form: ${JSON.stringify(form)}`)
    check('Export form pre-ticked from the plan (dataset, dates, a file or station tick)', form.dataset === 'rainfall' && /^2026-08/.test(form.start || '') && (form.files.length > 0 || form.stations.length > 0), JSON.stringify(form))
    await page.screenshot({ path: `${OUT}/03-access-data-line.png`, fullPage: false })
    const viz = page.locator('[data-testid="access-ai-visualize"]')
    const vizHref = await viz.getAttribute('href').catch(() => null)
    check('Visualize link points at the viewer', !!vizHref && vizHref.startsWith('/viewer/'), vizHref || 'none')
    if (vizHref) {
      await viz.click()
      await page.waitForURL(/\/viewer\//, { timeout: 15000 }).catch(() => {})
      await page.waitForSelector('.leaflet-container', { timeout: 30000 }).catch(() => {})
      check('Visualize opened the viewer', new URL(page.url()).pathname.startsWith('/viewer/'), new URL(page.url()).pathname)
      await page.screenshot({ path: `${OUT}/05-visualize.png`, fullPage: false })
    }
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  if (errors.length) console.log('console errors verbatim:\n  ' + errors.join('\n  '))
  await page.close()
} finally { await browser.close() }
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`)
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1))
process.exit(failed ? 1 : 0)
