import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative w-full rounded-md border px-3.5 py-2.5 text-sm [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3 [&>svg~*]:pl-6',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-foreground',
        destructive:
          'border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] text-destructive [&>svg]:text-destructive',
        warning:
          'border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
))
Alert.displayName = 'Alert'

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-0.5 font-medium leading-none tracking-tight', className)} {...props} />
))
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm opacity-90 [&_p]:leading-relaxed', className)} {...props} />
))
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertTitle, AlertDescription }
