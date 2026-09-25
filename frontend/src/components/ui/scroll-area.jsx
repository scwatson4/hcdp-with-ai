import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'

// orientation: 'vertical' (default) | 'horizontal' | 'both' — which scrollbar(s)
// to render. Horizontal is needed for rows of tabs/chips that overflow sideways.
const ScrollArea = React.forwardRef(({ className, children, viewportClassName, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <ScrollAreaPrimitive.Viewport className={cn('h-full w-full rounded-[inherit]', viewportClassName)}>
      {children}
    </ScrollAreaPrimitive.Viewport>
    {orientation !== 'horizontal' && <ScrollBar orientation="vertical" />}
    {orientation !== 'vertical' && <ScrollBar orientation="horizontal" />}
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = 'ScrollArea'

const ScrollBar = React.forwardRef(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent p-[1px]',
      orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent p-[1px]',
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border-strong" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = 'ScrollBar'

export { ScrollArea, ScrollBar }
