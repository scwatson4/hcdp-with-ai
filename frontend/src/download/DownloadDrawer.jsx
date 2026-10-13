import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import DownloadPanel from './DownloadPanel'

// The drawer the offer card (and the Access Data line) opens: a right-hand sheet with the shared DownloadPanel inside
// (gallery D2 A, 13 Oct). Everything it shows also has a page of its own at /download?ask=…&picks=…
export default function DownloadDrawer({ open, onOpenChange, ask, hints = {}, context = {}, initialPlan = null, apiUrl = null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[560px] max-w-[96vw] overflow-y-auto p-5 sm:p-6" data-testid="download-drawer" aria-describedby={undefined}>
        <SheetTitle className="sr-only">AI-prepared download</SheetTitle>
        <SheetDescription className="sr-only">The files the AI would prepare for your ask, each confirmed against HCDP's files; tick what you want and download with your HCDP API key.</SheetDescription>
        {open && <DownloadPanel ask={ask} hints={hints} context={context} initialPlan={initialPlan} apiUrl={apiUrl} />}
      </SheetContent>
    </Sheet>
  )
}
