import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

function legacyCopy(text) {
  try {
    if (typeof document.execCommand !== 'function') return false
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return Boolean(ok)
  } catch {
    return false
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  return legacyCopy(text)
}

// A small "Copy" button; `what` names the thing for screen readers.
export function CopyButton({ text, what = 'text', className }) {
  const [state, setState] = useState('idle') // idle | copied | failed
  const timer = useRef()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const onClick = async () => {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className={cn('h-7 shrink-0 gap-1 px-2 text-xs', className)} aria-label={`Copy ${what}`}>
      {state === 'copied' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}</span>
    </Button>
  )
}

// A block of text (a citation, a URL) with a Copy button beside it.
export function CopyBlock({ text, what, children, className }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border border-border bg-surface p-3', className)}>
      <div className="min-w-0 flex-1 break-words text-sm leading-relaxed">{children ?? text}</div>
      <CopyButton text={text} what={what} />
    </div>
  )
}

// A code sample with its language label and a Copy button.
export function CodeBlock({ code, language, what = 'code' }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-inset">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-subtle">{language}</span>
        <CopyButton text={code} what={what} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code className="font-mono">{code}</code></pre>
    </div>
  )
}
