import { primeKeyboard } from '../components/overlayHistory'

// The phone's Ask AI sheet (M2 A, AskSheet.jsx) is an overlay with its own history entry, id 'ask'. A tap that opens it
// raises the keyboard at once (iOS needs the focus inside the tap) so the sheet's field can take it over, and may name
// where the goo melts to on close (the viewer's Ask AI pill); both are read once by the sheet.
export const ASK_SHEET = 'ask'

let focusOnOpen = false
let origin = null   // { x, y } in viewport pixels, or null for the sheet's bottom edge

/** Open the sheet from a tap. `open` is useOverlayHistory(ASK_SHEET).open. */
export function openAskSheetFromTap(open, { focus = true, from = null } = {}) {
  if (focus) { primeKeyboard(); focusOnOpen = true }
  origin = from
  open()
}
export function takeFocusOnOpen() { const f = focusOnOpen; focusOnOpen = false; return f }
export const sheetOrigin = () => origin
export function clearSheetOrigin() { origin = null }
