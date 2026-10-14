// End-to-end smoke test of the review-period feedback (F1–F5): the right-edge tab and the composer, the selection pill,
// 👍 / 👎 on an AI overview (the 👎 chooser, then the composer), "My feedback", the phone sheet, and the admin page's
// refusal of a wrong key. It stores two clearly labelled items (reviewer "Smoke test (automated)") — mark them won't fix
// on /admin/feedback. Usage: node e2e/feedback_smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from '/tmp/smokedir/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://127.0.0.1:8010'
const OUT = process.argv[3] || '/tmp/claude-1001/-home-exouser/064baeac-7523-4d99-8946-e07207afc920/scratchpad/feedback_smoke'
const NAME = 'Smoke test (automated)'
const NOTE = 'Automated smoke test after a deploy — please ignore (mark won’t fix).'
fs.mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const consoleErrors = []
let expect401 = false   // the admin step sends a wrong key on purpose: Chrome logs that 401 as a console error
const settle = (page) => page.waitForTimeout(450)   // the panel, the sheet and the pill fade in over 200–250 ms

const browser = await chromium.launch()
const watch = (page, label) => {
  page.on('console', (m) => { if (m.type() === 'error' && !(expect401 && /status of 401/.test(m.text()))) consoleErrors.push(`[${label}] console: ${m.text()}`) })
  page.on('pageerror', (e) => { const t = String(e); if (!/reading 'Control'/.test(t)) consoleErrors.push(`[${label}] pageerror: ${t}`) })
}
try {
  // ── desktop ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((name) => { try { localStorage.setItem('hcdp-reviewer-name', name) } catch { /* private */ } }, NAME)
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  const page = await ctx.newPage()
  watch(page, 'desktop')
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const tab = page.locator('[data-testid="feedback-tab"]')
  const tb = await tab.boundingBox()
  check('desktop: the Give feedback tab is on the landing, at the right edge, 44 px wide', !!tb && Math.round(tb.width) === 44 && Math.round(tb.x + tb.width) === 1440, tb ? `${Math.round(tb.width)}×${Math.round(tb.height)} at x=${Math.round(tb.x)}` : 'missing')
  await page.screenshot({ path: `${OUT}/01-landing-tab-desktop.png` })
  await tab.click()
  const panel = page.locator('[data-testid="feedback-panel"]')
  await panel.waitFor({ timeout: 5000 })
  await settle(page)
  check('desktop: the tab opens the composer as a right-side panel with the feature picker', (await panel.getAttribute('data-variant')) === 'panel' && (await page.locator('[data-testid="composer-feature"]').count()) === 8)
  await page.screenshot({ path: `${OUT}/02-composer-desktop.png` })
  await page.locator('[data-testid="feedback-close"]').click()

  // ask the assistant; the destination opens with its AI overview
  const input = page.locator('[data-testid="assistant-input"]').first()
  await input.fill('Take me to the Hurricane Lowell report')
  await input.press('Enter')
  const ready = await page.waitForFunction(() => document.querySelector('[data-testid="ai-summary"]')?.dataset.status === 'ready', null, { timeout: 60000 }).then(() => true).catch(() => false)
  check('desktop: the assistant navigated and the AI overview is ready', ready, new URL(page.url()).pathname)
  if (ready) {
    const row = page.locator('[data-testid="overview-feedback"]')
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/03-overview-thumbs.png` })
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/feedback') && r.request().method() === 'POST', { timeout: 10000 }),
      row.locator('[data-testid="thumbs-up"]').click(),
    ])
    const toast = await page.locator('[data-testid="feedback-toast"]').textContent({ timeout: 3000 }).catch(() => '')
    check('desktop: 👍 on the overview posts 200 and says Thanks', resp.status() === 200 && /Thanks/.test(toast), `${resp.status()} · “${toast}”`)
    await page.screenshot({ path: `${OUT}/04-thumbs-up-toast.png` })
    await row.locator('[data-testid="thumbs-down"]').click()
    const chooser = page.locator('[data-testid="thumbs-chooser"]')
    await chooser.waitFor({ timeout: 3000 })
    await settle(page)
    const rows = await chooser.locator('[data-testid="thumbs-chooser-row"]').count()
    check('desktop: 👎 opens "Which page did you want?" with the alternatives and Other…', (await chooser.textContent()).includes('Which page did you want?') && (await chooser.locator('[data-testid="thumbs-chooser-other"]').count()) === 1, `${rows} rows`)
    await chooser.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/05-thumbs-down-chooser.png` })
    if (rows > 0) await chooser.locator('[data-testid="thumbs-chooser-row"]').first().click()
    else { await chooser.locator('[data-testid="thumbs-chooser-other"]').click(); await chooser.locator('[data-testid="thumbs-chooser-text"]').fill('the rainfall maps'); await chooser.locator('[data-testid="thumbs-chooser-next"]').click() }
    await panel.waitFor({ timeout: 3000 })
    await settle(page)
    check('desktop: …then the composer, with the wanted page and the exchange attached', (await page.locator('[data-testid="composer-wanted"]').count()) === 1 && (await page.locator('[data-testid="composer-exchange"]').count()) === 1)
    await page.locator('[data-testid="composer-text"]').fill(NOTE)
    await page.screenshot({ path: `${OUT}/06-composer-after-thumbs-down.png` })
    const [sent] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/feedback') && r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('[data-testid="composer-send"]').click(),
    ])
    check('desktop: Send posts 200', sent.status() === 200, String(sent.status()))
    await page.locator('[data-testid="feedback-toast-action"]').click({ timeout: 3000 })
    await page.locator('[data-testid="mine-item"]').first().waitFor({ timeout: 8000 }).catch(() => {})
    await settle(page)
    const mine = await page.locator('[data-testid="mine-item"]').allTextContents()
    check('desktop: the item appears under "My feedback"', mine.some((t) => t.includes('Automated smoke test')), `${mine.length} items under “${NAME}”`)
    await page.screenshot({ path: `${OUT}/07-my-feedback.png` })
    await page.locator('[data-testid="feedback-view-others"]').click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/08-others.png` })
    await page.locator('[data-testid="feedback-close"]').click()
  }

  // the selection pill
  await page.goto(BASE + '/about', { waitUntil: 'networkidle' })
  const para = page.locator('#main p').first()
  await para.scrollIntoViewIfNeeded()
  await para.click({ clickCount: 3 })
  const pill = page.locator('[data-testid="selection-pill"]')
  const shown = await pill.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)
  await settle(page)
  check('desktop: selecting text shows the "Copy · Give feedback" pill', shown && (await pill.textContent()) === 'CopyGive feedback')
  await page.screenshot({ path: `${OUT}/09-selection-pill.png` })
  if (shown) {
    await pill.locator('[data-testid="selection-feedback"]').click()
    await settle(page)
    const quoted = await page.locator('[data-testid="composer-quote"]').count()
    check('desktop: Give feedback opens the composer with the passage quoted', quoted === 1)
    await page.screenshot({ path: `${OUT}/10-composer-with-quote.png` })
    await page.keyboard.press('Escape')
  }

  // the viewer: the tab must not cover the map's furniture
  await page.goto(BASE + '/viewer/rainfall/day/2026-09-07/kauai', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-container', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const overlap = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="feedback-tab"]')?.getBoundingClientRect()
    if (!t) return ['no tab']
    const hits = []
    for (const sel of ['.leaflet-control-zoom', '[data-testid="compass-rose"]', '[data-testid="legend"]', '.leaflet-control-scale', '[data-testid="viewer-title-card"]']) {
      const b = document.querySelector(sel)?.getBoundingClientRect()
      if (b && b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top) hits.push(sel)
    }
    return hits
  })
  check('desktop: on the viewer the tab covers none of the map furniture', overlap.length === 0, overlap.join(', '))
  await page.screenshot({ path: `${OUT}/11-viewer-tab-desktop.png` })

  // the admin page refuses a wrong key
  await page.goto(BASE + '/admin/feedback', { waitUntil: 'networkidle' })
  expect401 = true
  await page.locator('[data-testid="admin-key"]').fill('not-the-key-smoke')
  await page.locator('[data-testid="admin-key-submit"]').click()
  const refused = await page.waitForSelector('[data-testid="admin-unauthorised"], [data-testid="admin-disabled"]', { timeout: 8000 }).then((el) => el.textContent()).catch(() => '')
  check('desktop: the admin page rejects a wrong key', /Not authorised|not enabled/.test(refused), refused)
  await page.screenshot({ path: `${OUT}/12-admin-wrong-key.png` })
  expect401 = false
  await ctx.close()

  // ── phone ──
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const phone = await pctx.newPage()
  watch(phone, 'phone')
  await phone.goto(BASE + '/', { waitUntil: 'networkidle' })
  await phone.screenshot({ path: `${OUT}/13-landing-tab-phone.png` })
  await phone.locator('[data-testid="feedback-tab"]').click()
  const sheet = phone.locator('[data-testid="feedback-panel"]')
  await sheet.waitFor({ timeout: 5000 })
  await settle(phone)
  const sb = await sheet.boundingBox()
  check('phone: the composer is a bottom sheet', (await sheet.getAttribute('data-variant')) === 'sheet' && !!sb && Math.round(sb.y + sb.height) === 844 && Math.round(sb.width) === 390, sb ? `${Math.round(sb.width)}×${Math.round(sb.height)} at y=${Math.round(sb.y)}` : '')
  check('phone: no horizontal scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.screenshot({ path: `${OUT}/14-composer-sheet-phone.png` })
  await phone.goto(BASE + '/viewer/rainfall/day/2026-09-07/kauai', { waitUntil: 'networkidle' })
  await phone.waitForTimeout(1500)
  await phone.screenshot({ path: `${OUT}/15-viewer-tab-phone.png` })
  await pctx.close()
} finally { await browser.close() }

check('no console errors or page errors', consoleErrors.length === 0, consoleErrors.length ? `${consoleErrors.length}` : '')
for (const e of consoleErrors) console.log(`  ${e}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`)
process.exit(failed ? 1 : 0)
