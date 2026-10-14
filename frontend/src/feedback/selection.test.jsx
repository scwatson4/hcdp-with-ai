import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, within, act } from '@testing-library/react'
import { SETTLE_MS } from './SelectionPill'
import { ask, checkedFeature, click, navigateReply, posts, renderApp, setup, state, teardown, tick } from './harness.test-utils'

// F1 A (b): select text anywhere → a small "Copy · Give feedback" pill above the selection (keyboard-reachable).
let writeText
beforeEach(() => {
  setup()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(teardown)

/** Select characters [from, to) of the first text node under `el`, the way a drag or Shift + arrows would. */
async function select(el, from = 0, to, child = 0) {
  const node = el.childNodes[child]
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to ?? node.textContent.length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
  await tick(SETTLE_MS + 10)
}

describe('the selection pill', () => {
  it('appears over selected page text with Copy and Give feedback; Copy copies the passage', async () => {
    renderApp('/data')
    expect(screen.queryByTestId('selection-pill')).toBeNull()
    await select(screen.getByTestId('body-text'), 4, 37)
    const pill = screen.getByTestId('selection-pill')
    expect(pill).toHaveAttribute('role', 'toolbar')
    expect(within(pill).getAllByRole('button').map((b) => b.textContent)).toEqual(['Copy', 'Give feedback'])
    expect(pill.style.position).toBe('fixed')
    for (const c of ['rounded-full', 'bg-foreground', 'text-canvas', 'print:hidden']) expect(pill.className).toContain(c)
    await click(within(pill).getByTestId('selection-copy'))
    expect(writeText).toHaveBeenCalledWith('HCDP was founded in 2019 to bring')
    expect(within(pill).getByTestId('selection-copy')).toHaveTextContent('Copied ✓')
  })

  it('Give feedback opens the composer with the passage quoted and the feature guessed; Send stores a selection item', async () => {
    renderApp('/data')
    await select(screen.getByTestId('body-text'), 4, 37)
    await click(screen.getByTestId('selection-feedback'))
    expect(screen.queryByTestId('selection-pill')).toBeNull()
    const panel = screen.getByTestId('feedback-panel')
    expect(within(panel).getByTestId('feedback-composer')).toHaveAttribute('data-kind', 'selection')
    expect(within(panel).getByTestId('composer-quote')).toHaveTextContent('“HCDP was founded in 2019 to bring”')
    expect(checkedFeature(panel)).toBe('page')
    expect(within(panel).getByTestId('composer-page-shown')).toHaveTextContent('/data')
    fireEvent.change(within(panel).getByTestId('composer-text'), { target: { value: 'The year is wrong — 2020.' } })
    await click(within(panel).getByTestId('composer-send'))
    expect(posts()[0].body).toMatchObject({ kind: 'selection', rating: null, feature: 'page', quote: 'HCDP was founded in 2019 to bring', text: 'The year is wrong — 2020.', page: { path: '/data' } })
  })

  it('a passage of an AI overview is about the overview, with its exchange attached', async () => {
    state.replies = [navigateReply('/mesonet')]
    renderApp('/data')
    await ask('take me to the mesonet')
    const chunk = screen.getAllByTestId('ai-summary-chunk')[1]
    await select(chunk, 0, 9)
    await click(screen.getByTestId('selection-feedback'))
    const panel = screen.getByTestId('feedback-panel')
    expect(checkedFeature(panel)).toBe('overview')
    expect(within(panel).getByTestId('composer-quote')).toHaveTextContent('“This page”')
    expect(within(panel).getByTestId('composer-ask')).toHaveTextContent('take me to the mesonet')
  })

  it('is reachable from the keyboard: Tab moves into it, Esc puts it away until the selection changes', async () => {
    renderApp('/data')
    await select(screen.getByTestId('body-text'), 4, 8)
    fireEvent.keyDown(document.body, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByTestId('selection-copy'))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByTestId('selection-pill')).toBeNull()
    fireEvent.keyUp(document.body, { key: 'Escape' })
    await tick(SETTLE_MS + 10)
    expect(screen.queryByTestId('selection-pill')).toBeNull()                       // the same selection stays dismissed
    await select(screen.getByTestId('body-text'), 9, 20)
    expect(screen.getByTestId('selection-pill')).toBeInTheDocument()                // a new one brings it back
  })

  it('stays away from text inside the feedback panel and from an empty selection', async () => {
    renderApp('/data')
    await select(screen.getByTestId('body-text'), 4, 37)
    await click(screen.getByTestId('selection-feedback'))
    await select(screen.getByTestId('composer-quote').querySelector('blockquote'), 1, 6, 1)   // “ · the quote · ”
    expect(screen.queryByTestId('selection-pill')).toBeNull()
    window.getSelection().removeAllRanges()
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    await tick(SETTLE_MS + 10)
    expect(screen.queryByTestId('selection-pill')).toBeNull()
  })
})
