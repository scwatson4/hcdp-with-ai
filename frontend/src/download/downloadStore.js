// The AI-prepared download's offer (gallery D1, 13 Oct): when the navigator answers a data ask with intent `download`
// it takes the visitor to /data/api and this tiny store remembers the offer — the ask as typed, the one-sentence offer,
// the navigator's hints and the catalog's API page URL — for the OfferCard at the top of that page. Memory only, one
// offer at a time, replaced by the next answer and gone when the visitor leaves the page by other means. Kept outside
// the AssistantProvider so the provider needs only two calls (noteDownload / clearDownload).
import { useSyncExternalStore } from 'react'

let offer = null   // { id, path, ask, offer, hints, apiUrl }
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

/** The navigator answered intent `download`: remember the offer for the page it navigates to. */
export function noteDownload(id, download, navPath) {
  if (!download || typeof download !== 'object') return
  const path = String(navPath || '/data/api').split('?')[0].split('#')[0]
  offer = {
    id,
    path,
    ask: typeof download.ask === 'string' && download.ask.trim() ? download.ask.trim().slice(0, 500) : '',
    offer: typeof download.offer === 'string' && download.offer.trim() ? download.offer.trim() : 'I can gather the HCDP files for this into one zip, with a README that says what is inside.',
    hints: download.hints && typeof download.hints === 'object' ? download.hints : {},
    apiUrl: typeof download.api_url === 'string' && /^https:\/\//.test(download.api_url) ? download.api_url : null,
  }
  emit()
}

export function clearDownload() {
  if (offer) { offer = null; emit() }
}

export function currentDownload() { return offer }

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }

/** The current offer (or null), as React state. */
export function useDownloadOffer() {
  return useSyncExternalStore(subscribe, currentDownload, currentDownload)
}
