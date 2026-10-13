import { useEffect, useState } from 'react'
import { ChevronsUp } from 'lucide-react'

// The portal's "Back To Top" double chevron (13 Oct): a dark tab at the bottom right that appears once the
// page has scrolled 300 px and scrolls smoothly back to the top. Hidden on print and when nothing to scroll.
export default function BackToTop() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 300)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return (
    <button type="button" aria-label="Back to top" title="Back To Top" data-testid="back-to-top" aria-hidden={!shown} tabIndex={shown ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}
      className={`fixed bottom-4 right-4 z-40 grid h-11 w-11 place-items-center rounded-md bg-[#1b1b1b] text-white shadow-lg transition-opacity duration-200 print:hidden hover:bg-black ${shown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      <ChevronsUp className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
