import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[2.5rem] w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors',
      'placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
