// HCDP lockup for the top-left of the conversation header: the authentic
// rainbow HCDP mark (cropped from the full portal logo — the original's
// wordmark is baked in as flat white/dark text that can't serve both themes)
// paired with typeset "Hawaiʻi Climate Data Portal" that we control.
//
// The mark is 3.8:1, so its height is fixed and width follows. The wordmark
// is two tight lines of small caps beside it. `level` (H2A) is decided by
// the header's layout plan from the free gap: 'full' = mark + wordmark,
// 'logo' = the mark alone, 'mark' = a smaller mark.
export default function HeaderLogo({ className = '', level = 'full' }) {
  const h = level === 'mark' ? 'h-[22px]' : 'h-[30px]'
  return (
    <span className={`flex shrink-0 select-none items-center gap-2 ${className}`} data-brand-level={level}>
      <img
        src="/hcdp_mark.png"
        alt="HCDP"
        width="334"
        height="88"
        decoding="async"
        className={`${h} w-auto dark:hidden`}
        draggable="false"
      />
      <img
        src="/hcdp_mark_dark.png"
        alt="HCDP"
        width="334"
        height="88"
        decoding="async"
        className={`hidden ${h} w-auto dark:block`}
        draggable="false"
      />
      {level === 'full' && (
        <span
          aria-hidden="true"
          className="flex flex-col justify-center font-nav text-[8.5px] font-semibold uppercase leading-[1.3] tracking-[0.07em] text-subtle"
        >
          <span>Hawaiʻi Climate</span>
          <span>Data Portal</span>
        </span>
      )}
    </span>
  )
}
