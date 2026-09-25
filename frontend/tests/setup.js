import '@testing-library/jest-dom/vitest'
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
