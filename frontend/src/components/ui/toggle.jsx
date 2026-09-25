import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toggleVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
    'hover:bg-muted hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'data-[state=on]:bg-accent-soft data-[state=on]:text-accent',
    'data-[state=on]:hover:bg-accent-soft/80',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-border bg-transparent',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-8 px-2.5',
        lg: 'h-10 px-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

const Toggle = React.forwardRef(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size, className }))} {...props} />
))
Toggle.displayName = 'Toggle'

export { Toggle, toggleVariants }
