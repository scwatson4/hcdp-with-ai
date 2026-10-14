import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/utils'

// A one-line confirmation that floats above the page for a moment ("Link copied") — M1 C (14 Oct): copying a link
// confirms here, so no button changes its label or its width under the visitor's thumb. role=status, so a screen
// reader says it once; it never takes the focus.
export const TOAST_MS = 2200

export function useToast() {
  const [toast, setToast] = useState(null)   // { id, text }
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = useCallback((text) => {
    clearTimeout(timer.current)
    setToast({ id: Date.now() + Math.random(), text })
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  return { toast, show }
}

export default function Toast({ toast, className, style }) {
  return (
    <div role="status" aria-live="polite" className={cn('pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4', className)} style={style}>
      {toast && (
        <p key={toast.id} className="hcdp-toast-in inline-flex items-center gap-2 rounded-full bg-[#1b1b1b] px-4 py-2.5 text-[14px] font-medium text-white shadow-lg" data-testid="toast">
          <Check className="h-4 w-4" aria-hidden="true" />{toast.text}
        </p>
      )}
    </div>
  )
}
