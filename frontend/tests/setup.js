import '@testing-library/jest-dom/vitest'
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
// 18 Oct: the Ask AI popup keeps its conversation in sessionStorage for the visit; every test starts a fresh visit.
beforeEach(() => { try { window.sessionStorage.clear() } catch { /* no storage */ } })
