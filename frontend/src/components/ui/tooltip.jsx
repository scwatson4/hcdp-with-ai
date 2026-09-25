import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const TooltipTrigger = TooltipPrimitive.Trigger

// Controlled wrapper around the Radix root: when the pointer leaves the
// page or the window loses focus (cmd-tab, click on another monitor), the
// pointerleave that would normally dismiss the tooltip never fires and the
// tip lingers on screen. Close any open tooltip on window blur / document
// mouseleave instead.
function Tooltip({ open: openProp, defaultOpen = false, onOpenChange, ...props }) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const handleOpenChange = React.useCallback(
    (next) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  React.useEffect(() => {
    if (!open) return undefined
    const dismiss = () => handleOpenChange(false)
    window.addEventListener('blur', dismiss)
    document.documentElement.addEventListener('mouseleave', dismiss)
    return () => {
      window.removeEventListener('blur', dismiss)
      document.documentElement.removeEventListener('mouseleave', dismiss)
    }
  }, [open, handleOpenChange])

  return <TooltipPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
}

const TooltipContent = React.forwardRef(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow',
      'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
TooltipContent.displayName = 'TooltipContent'

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
