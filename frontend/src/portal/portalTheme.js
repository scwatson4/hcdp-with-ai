// The mirrored pages' styles (CONTRACT.md "Mirrored pages", 14 Oct). Each page renders HCDP's markup inside an open
// shadow root, so neither Tailwind's preflight nor our tokens reach it, and HCDP's theme never leaks into our shell.
// Three sheets are adopted, in this order:
//   1. the theme bundle — HCDP's bootstrap.min.css, OnePress style.css, the full block library, classic-theme-styles,
//      global-styles, wp-custom-css, Font Awesome's classes and the .wrapper helper — downloaded once by
//      scripts/portal_theme.py into public/portal/theme.<hash>.css (versioned, immutable), rewritten for a shadow root
//      (html/:root → :host, body → .hcdp-body, rem → var(--hcdp-rem));
//   2. HOST_CSS below — the host's own font and colour (HCDP's body: 14px/1.7 system stack, #777 on white), and the few
//      classes the sanitiser adds (the ↗ on external links, embeds, the Google Form's phone button);
//   3. the page's own CSS (its block-supports layout classes and content <style> blocks), from the page's JSON.
// One CSSStyleSheet object per sheet is shared by every page (constructable stylesheets); a browser without them gets
// <style> elements inside the shadow root instead.
import theme from './theme.json'

export const THEME_URL = theme.file

export const HOST_CSS = `
:host{display:block;font:400 14px/1.7 -apple-system,system-ui,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#777;background:#fff;overflow-x:clip}
.hcdp-body{background:#fff;min-height:1px}
.hcdp-mirror-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.hcdp-mirror-ext{font-size:.85em;text-decoration:none}
/* 15 Oct: HCDP's icon buttons (the Library's "Search Publications", class btn fa fa-search) get a gap between the glyph and
   the words, and no external-link arrow inside the button (the sr-only "(opens in a new tab)" stays). */
.btn.fa::before,.btn[class*=" fa-"]::before{margin-right:.6em}
.btn .hcdp-mirror-ext,.wp-block-button__link .hcdp-mirror-ext{display:none}
.hcdp-mirror-iframe{display:block;border:0;max-width:100%}
.hcdp-mirror-iframe-fluid{width:100%;min-height:360px}
.hcdp-mirror-form-frame{display:block;width:100%;border:0}
.hcdp-mirror-form-open{display:none;margin:1em 0}
@media (max-width:639px){.hcdp-mirror-form-frame{display:none}.hcdp-mirror-form-open{display:block}}
.hcdp-mirror-embedded-link{margin:0 0 1.5em;padding:12px 16px;border-left:3px solid #03c4eb;background:#f8f9f9;font-style:normal}
.hcdp-mirror-embed-link{margin:1em 0}
.hcdp-mirror-slideshow{display:flex;flex-wrap:wrap;gap:16px}
.hcdp-mirror-slideshow figure{flex:1 1 280px;margin:0}
.hcdp-mirror-slideshow img{width:100%;height:auto;display:block}
.hcdp-mirror-ring{box-shadow:0 0 0 4px #03c4eb!important;transition:box-shadow .3s ease}
:target,.hcdp-mirror-target{scroll-margin-top:calc(var(--hcdp-sticky-h, 7rem) + 12px)}
`

// HCDP loads Font Awesome 4.7 for its icon classes (the Library's "Search Publications" button). Fonts cannot be
// declared inside a shadow root, so the @font-face goes on the document — only when a page uses the classes.
const FA_FONT_FACE = "@font-face{font-family:'FontAwesome';src:url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/fonts/fontawesome-webfont.woff2?v=4.7.0') format('woff2'),url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/fonts/fontawesome-webfont.woff?v=4.7.0') format('woff');font-weight:normal;font-style:normal;font-display:block}"

export function supportsAdoptedSheets() {
  try {
    return typeof ShadowRoot !== 'undefined' && 'adoptedStyleSheets' in ShadowRoot.prototype && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype
  } catch { return false }
}

function sheetFrom(text) {
  try {
    const s = new CSSStyleSheet()
    s.replaceSync(text)
    return s
  } catch { return null }
}

let themePromise = null
let themeLoaded = null

/** The theme bundle, fetched once per document: { text, sheet (or null), host (or null) }. */
export function loadTheme() {
  if (themeLoaded) return Promise.resolve(themeLoaded)
  if (!themePromise) {
    themePromise = fetch(THEME_URL)
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '')
      .then((text) => {
        const adopt = supportsAdoptedSheets()
        themeLoaded = { text, sheet: adopt ? sheetFrom(text) : null, host: adopt ? sheetFrom(HOST_CSS) : null }
        return themeLoaded
      })
  }
  return themePromise
}

/** The theme if it is already here (so a page that has it renders in the same frame). */
export const themeNow = () => themeLoaded

/** For tests: forget the loaded theme. */
export function resetTheme() { themePromise = null; themeLoaded = null }

const pageSheets = new Map()   // page css text → CSSStyleSheet (pages revisited share one)

/** Put the theme, the host CSS and the page's CSS into a shadow root. */
export function applyStyles(root, themeObj, pageCss) {
  if (themeObj?.sheet && themeObj?.host && supportsAdoptedSheets()) {
    let page = pageSheets.get(pageCss)
    if (!page) {
      page = sheetFrom(pageCss || '')
      if (page) {
        if (pageSheets.size > 40) pageSheets.delete(pageSheets.keys().next().value)
        pageSheets.set(pageCss, page)
      }
    }
    root.adoptedStyleSheets = [themeObj.sheet, themeObj.host, ...(page ? [page] : [])]
    return 'adopted'
  }
  return 'inline'
}

/** The <style> elements a shadow root needs when it cannot adopt sheets (prepended to its markup). */
export function inlineStyles(themeObj, pageCss) {
  const esc = (t) => String(t || '').replace(/<\/style/gi, '<\\/style')
  return `<style>${esc(themeObj?.text)}</style><style>${esc(HOST_CSS)}</style><style>${esc(pageCss)}</style>`
}

let faInjected = false
/** Font Awesome's font, declared on the document once, when a page's markup uses its classes. */
export function ensureFontAwesome(html) {
  if (faInjected || typeof document === 'undefined' || !/class="[^"]*\bfa\b/.test(html || '')) return false
  const st = document.createElement('style')
  st.setAttribute('data-hcdp-fa', '')
  st.textContent = FA_FONT_FACE
  document.head.appendChild(st)
  faInjected = true
  return true
}
