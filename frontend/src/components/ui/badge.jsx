import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-accent-foreground',
        outline: 'border-border text-foreground bg-transparent',
        soft: 'border-transparent bg-accent-soft text-accent',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-transparent bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]',
        warning: 'border-transparent bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]',
        destructive: 'border-transparent bg-[hsl(var(--destructive)/0.12)] text-destructive',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
)

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
