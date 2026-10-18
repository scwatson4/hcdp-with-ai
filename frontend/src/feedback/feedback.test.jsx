import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, within, act } from '@testing-library/react'
import { NAME_KEY } from './reviewer'
import { INFO, ask, checkedFeature, click, json, navigateReply, posts, radio, renderApp, setup, state, teardown, tick } from './harness.test-utils'

// The review-period feedback (F1 A–F5 A, 13 Oct): thumbs on answers and overviews, the 👎 chooser, the composer, the tab.
beforeEach(() => setup())
afterEach(teardown)

describe('👍 / 👎 on an AI overview (F1 A, F5 A)', () => {
  it('👍 sits beside "Wrong page?" at the end of the block and sends a one-tap positive with the exchange; a toast says "Thanks"', async () => {
    state.replies = [navigateReply('/mesonet')]
    renderApp('/data')
    await ask('take me to the mesonet')
    const block = screen.getByTestId('ai-summary')
    const row = within(block).getByTestId('overview-feedback')
    expect(within(row).getByTestId('wrong-page-link')).toHaveTextContent('Wrong page?')            // the same last row
    const up = within(row).getByTestId('thumbs-up')
    expect(up.className).toContain('h-7'); expect(up.className).toContain('text-subtle')            // small and subtle
    expect(up.className).toContain('[@media(pointer:coarse)]:h-11')
    await click(up)
    const [post] = posts()
    expect(post.body).toMatchObject({ kind: 'thumbs', rating: 'up', feature: 'overview', page: { path: '/mesonet', title: 'Page /mesonet' }, ask: 'take me to the mesonet',
      overview_id: 'f'.repeat(32), text: '', quote: null, wanted: null, reviewer_name: '' })
    expect(post.body.reply).toBe('Taking you to /mesonet.\n\nAI Overview: You asked for the Mesonet. This page embeds the live viewer.')
    expect(screen.getByTestId('feedback-toast')).toHaveTextContent('Thanks')
    expect(up).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('feedback-panel')).toBeNull()                                         // no composer for a 👍
    await click(up)
    expect(posts()).toHaveLength(1)                                                                    // once
  })

  it('👎 first asks "Which page did you want?" (the alternatives, then Other…); a row opens the composer with that page attached, and Send stores it', async () => {
    state.replies = [navigateReply('/mesonet')]
    renderApp('/data')
    await ask('take me to the mesonet')
    const block = screen.getByTestId('ai-summary')
    await click(within(block).getByTestId('thumbs-down'))
    const chooser = within(block).getByTestId('thumbs-chooser')
    expect(chooser).toHaveTextContent('Which page did you want?')
    const rows = within(chooser).getAllByTestId('thumbs-chooser-row')
    expect(rows.map((r) => r.textContent)).toEqual(['Access Data · downloads', 'Mesonet app · the app'])
    expect(within(chooser).getByTestId('thumbs-chooser-other')).toHaveTextContent('Other…')
    expect(screen.queryByTestId('feedback-panel')).toBeNull()                                         // the chooser comes first
    await click(rows[0])
    const panel = screen.getByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-view', 'compose'); expect(panel).toHaveAttribute('data-variant', 'panel')
    expect(within(panel).getByTestId('composer-thumbs-note')).toHaveTextContent('You flagged this AI Overview')
    expect(within(panel).getByTestId('composer-wanted')).toHaveTextContent('Access Data')
    expect(within(panel).getByTestId('composer-wanted')).toHaveTextContent('/data')
    expect(within(panel).getByTestId('composer-ask')).toHaveTextContent('take me to the mesonet')
    expect(within(panel).getByTestId('composer-reply')).toHaveTextContent('Taking you to /mesonet.')
    expect(within(panel).getByTestId('composer-overview')).toHaveTextContent('This page embeds the live viewer.')
    expect(checkedFeature(panel)).toBe('overview')
    expect(screen.getByTestId('probe')).toHaveTextContent('/mesonet')                                  // the pick files, it does not travel
    const send = within(panel).getByTestId('composer-send')
    expect(send).toBeDisabled()                                                                        // the words are required
    fireEvent.change(within(panel).getByTestId('composer-text'), { target: { value: 'I wanted the station CSVs.' } })
    fireEvent.change(within(panel).getByTestId('composer-name'), { target: { value: 'Ikaika' } })
    expect(send).not.toBeDisabled()
    await click(send)
    const post = posts().at(-1)
    expect(post.body).toMatchObject({ kind: 'thumbs', rating: 'down', feature: 'overview', wanted: { title: 'Access Data', url: '/data' }, text: 'I wanted the station CSVs.',
      reviewer_name: 'Ikaika', page: { path: '/mesonet' }, ask: 'take me to the mesonet', overview_id: 'f'.repeat(32), quote: null })
    expect(screen.queryByTestId('feedback-panel')).toBeNull()
    expect(screen.getByTestId('feedback-toast')).toHaveTextContent('Thanks — your feedback is in.')
    expect(window.localStorage.getItem(NAME_KEY)).toBe('Ikaika')
    expect(within(block).getByTestId('thumbs-down')).toHaveAttribute('aria-pressed', 'true')
    await tick(5)
    expect(document.activeElement).toBe(within(block).getByTestId('thumbs-down'))                   // the focus comes back to the 👎
  })

  it('"Other…" takes a line of text to the composer; "Skip" opens it with no page; the wanted page can be removed', async () => {
    state.replies = [navigateReply('/mesonet')]
    renderApp('/data')
    await ask('take me to the mesonet')
    const block = screen.getByTestId('ai-summary')
    await click(within(block).getByTestId('thumbs-down'))
    await click(within(block).getByTestId('thumbs-chooser-other'))
    const next = within(block).getByTestId('thumbs-chooser-next')
    expect(next).toBeDisabled()
    fireEvent.change(within(block).getByTestId('thumbs-chooser-text'), { target: { value: 'the Lowell wind map' } })
    await click(next)
    let panel = screen.getByTestId('feedback-panel')
    expect(within(panel).getByTestId('composer-wanted')).toHaveTextContent('“the Lowell wind map”')
    await click(within(panel).getByTestId('composer-wanted-remove'))
    expect(within(panel).queryByTestId('composer-wanted')).toBeNull()
    fireEvent.change(within(panel).getByTestId('composer-text'), { target: { value: 'The overview repeats itself.' } })
    await click(within(panel).getByTestId('composer-send'))
    expect(posts().at(-1).body).toMatchObject({ kind: 'thumbs', rating: 'down', wanted: null, text: 'The overview repeats itself.' })
    await click(within(block).getByTestId('thumbs-down'))
    await click(within(block).getByTestId('thumbs-chooser-skip'))
    panel = screen.getByTestId('feedback-panel')
    expect(within(panel).queryByTestId('composer-wanted')).toBeNull()
    expect(within(panel).getByTestId('composer-exchange')).toBeInTheDocument()
  })
})

describe('👍 / 👎 on every AI answer (F1 A)', () => {
  it('in the docked dropdown: 👍 sends the answer with its question; 👎 lists the answer’s alternatives', async () => {
    state.replies = [INFO]
    renderApp('/data')
    await ask('what is hcdp')
    const bubble = within(screen.getByTestId('assistant-dropdown')).getByTestId('assistant-bubble')
    await click(within(bubble).getByTestId('thumbs-up'))
    expect(posts()[0].body).toMatchObject({ kind: 'thumbs', rating: 'up', feature: 'answer', ask: 'what is hcdp', reply: 'HCDP is the Hawaiʻi Climate Data Portal.', overview_id: null, page: { path: '/data' } })
    await click(within(bubble).getByTestId('thumbs-down'))
    expect(within(bubble).getAllByTestId('thumbs-chooser-row')).toHaveLength(2)
    await click(within(bubble).getByTestId('thumbs-chooser-skip'))
    const panel = screen.getByTestId('feedback-panel')
    expect(checkedFeature(panel)).toBe('answer')
    expect(within(panel).getByTestId('composer-reply')).toHaveTextContent('HCDP is the Hawaiʻi Climate Data Portal.')
  })

  it('in the landing answer card', async () => {
    state.replies = [INFO]
    renderApp('/')
    await ask('what is hcdp')
    const card = screen.getByTestId('landing-answers')
    await click(within(card).getByTestId('thumbs-up'))
    expect(posts()[0].body).toMatchObject({ kind: 'thumbs', rating: 'up', feature: 'answer', ask: 'what is hcdp', page: { path: '/' } })
  })
})

describe('the bottom-left tab and the composer (F1 A, F2 A, F4 A)', () => {
  it('the tab is on every page, the landing included: a small horizontal pill at the bottom-left, chip-styled, hidden in print; it opens the composer with the feature picker', async () => {
    renderApp('/')
    const tab = screen.getByTestId('feedback-tab')
    expect(tab).toHaveTextContent('Give feedback')
    for (const c of ['fixed', 'bottom-3', 'left-3', 'min-h-6', 'text-[12px]', 'rounded-full', 'print:hidden', 'border', 'bg-card']) expect(tab.className).toContain(c)
    expect(tab.className).not.toContain('right-0')
    expect(tab.querySelector('span').className).not.toContain('vertical-rl')
    expect(tab).toHaveAttribute('aria-haspopup', 'dialog')
    tab.focus()                                                                                        // a keyboard user on the tab
    await click(tab)
    const panel = screen.getByTestId('feedback-panel')
    expect(panel).toHaveAttribute('role', 'dialog')
    expect(panel.className).not.toContain('right-0')                                                  // 15 Oct: it opens from the left, the pill's side
    if (panel.dataset.variant === 'panel') expect(panel.className).toContain('left-0')
    expect(within(panel).getByTestId('feedback-panel-title')).toHaveTextContent('Give feedback')
    const labels = [...panel.querySelectorAll('[data-testid="composer-feature"]')].map((r) => r.closest('label').textContent)
    expect(labels).toEqual(['AI answer', 'Navigation result', 'AI Overview', 'Visualize Data', 'Downloads', 'Feedback itself', 'A page', 'Other'])
    expect(checkedFeature(panel)).toBe('page')
    expect(within(panel).getByTestId('composer-page-shown')).toHaveTextContent('/')
    expect(within(panel).queryByTestId('composer-exchange')).toBeNull()                               // nothing asked yet
    expect(tab).toHaveAttribute('data-open', 'true')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByTestId('feedback-panel')).toBeNull()
    await tick(5)
    expect(document.activeElement).toBe(screen.getByTestId('feedback-tab'))                           // the focus comes back
  })

  it('picking "AI answer" attaches the last question and answer (shown, removable); the page is editable; Send posts the item', async () => {
    state.replies = [INFO]
    renderApp('/data')
    await ask('what is hcdp')
    await click(screen.getByTestId('feedback-tab'))
    const panel = screen.getByTestId('feedback-panel')
    expect(within(panel).queryByTestId('composer-exchange')).toBeNull()
    await click(radio(panel, 'answer'))
    const ex = within(panel).getByTestId('composer-exchange')
    expect(ex).toHaveTextContent('Attached automatically')
    expect(within(ex).getByTestId('composer-ask')).toHaveTextContent('what is hcdp')
    expect(within(ex).getByTestId('composer-reply')).toHaveTextContent('HCDP is the Hawaiʻi Climate Data Portal.')
    fireEvent.click(radio(panel, 'navigation'))
    expect(within(panel).getByTestId('composer-exchange')).toBeInTheDocument()
    await click(within(panel).getByTestId('composer-exchange-remove'))
    expect(within(panel).queryByTestId('composer-exchange')).toBeNull()
    await click(within(panel).getByTestId('composer-page-edit'))
    fireEvent.change(within(panel).getByTestId('composer-page-title'), { target: { value: 'Access Data (export)' } })
    fireEvent.change(within(panel).getByTestId('composer-page-path'), { target: { value: 'data#export' } })
    fireEvent.change(within(panel).getByTestId('composer-text'), { target: { value: 'The export button is hard to find.' } })
    await click(within(panel).getByTestId('composer-send'))
    expect(posts()[0].body).toEqual({ kind: 'tab', rating: null, feature: 'navigation', page: { path: '/data#export', title: 'Access Data (export)' }, quote: null,
      ask: null, reply: null, overview_id: null, wanted: null, text: 'The export button is hard to find.', reviewer_name: '' })
  })

  it('remembers the reviewer’s name in this browser and says so under the field; a refusal keeps the words and shows why', async () => {
    window.localStorage.setItem(NAME_KEY, 'Leilani')
    state.feedback = () => json({ detail: 'That is a lot of feedback from one connection in a short time. Wait a minute and try again.' }, 429)
    renderApp('/data')
    await click(screen.getByTestId('feedback-tab'))
    const name = screen.getByTestId('composer-name')
    expect(name).toHaveValue('Leilani')
    const note = screen.getByTestId('composer-name-note')
    expect(note).toHaveTextContent('Remembered in your browser')
    expect(name).toHaveAttribute('aria-describedby', note.id)
    fireEvent.change(screen.getByTestId('composer-text'), { target: { value: 'The legend hides the compass.' } })
    await click(screen.getByTestId('composer-send'))
    expect(screen.getByTestId('composer-error')).toHaveTextContent('Wait a minute')
    expect(screen.getByTestId('composer-text')).toHaveValue('The legend hides the compass.')
    expect(posts()[0].body.reviewer_name).toBe('Leilani')
    // closing keeps the draft for the next time
    await click(screen.getByTestId('feedback-close'))
    await click(screen.getByTestId('feedback-tab'))
    expect(screen.getByTestId('composer-text')).toHaveValue('The legend hides the compass.')
  })

  it('on narrow or touch screens the tab tucks away while the page scrolls down and comes back on the way up', async () => {
    window.matchMedia = (q) => ({ matches: q === '(max-width: 1023px), (pointer: coarse)', addEventListener() {}, removeEventListener() {} })
    renderApp('/data')
    const tab = screen.getByTestId('feedback-tab')
    const scrollTo = async (y) => { Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true }); await act(async () => { window.dispatchEvent(new Event('scroll')) }) }
    expect(tab).toHaveAttribute('data-tucked', 'false')
    await scrollTo(400)
    expect(tab).toHaveAttribute('data-tucked', 'true'); expect(tab.className).toContain('translate-y-[calc(100%+1.5rem)]')
    await scrollTo(390)
    expect(tab).toHaveAttribute('data-tucked', 'true')                                                // a small wobble does not bring it back
    await scrollTo(300)
    expect(tab).toHaveAttribute('data-tucked', 'false')
    await scrollTo(700)
    expect(tab).toHaveAttribute('data-tucked', 'true')
    fireEvent.focus(tab)
    expect(tab).toHaveAttribute('data-tucked', 'false')                                               // the keyboard brings it back
    await scrollTo(0)
    expect(tab).toHaveAttribute('data-tucked', 'false')
  })

  it('on a phone the composer is a bottom sheet', async () => {
    teardown(); setup({ phone: true })
    renderApp('/data')
    await click(screen.getByTestId('feedback-tab'))
    const panel = screen.getByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-variant', 'sheet')
    for (const c of ['bottom-0', 'inset-x-0', 'rounded-t-xl', 'max-h-[88dvh]']) expect(panel.className).toContain(c)
    expect(within(panel).getByTestId('sheet-grab')).toBeInTheDocument()
    expect(document.activeElement).not.toBe(screen.getByTestId('composer-text'))                     // no keyboard until a tap
  })
})
