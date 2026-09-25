import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from './ThemeProvider'

const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' }

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const label = THEME_LABEL[theme] || 'System'
  return (
    <DropdownMenu>
      {/* Tooltip wraps the dropdown trigger so hovering the moon/sun button
          names the active appearance (the icon alone is ambiguous). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme" data-tutorial="theme">
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Theme · {label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="h-4 w-4" /> Light {theme === 'light' && <span className="ml-auto text-subtle">•</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="h-4 w-4" /> Dark {theme === 'dark' && <span className="ml-auto text-subtle">•</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="h-4 w-4" /> System {theme === 'system' && <span className="ml-auto text-subtle">•</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
