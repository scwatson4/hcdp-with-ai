import { Link } from 'react-router-dom'

// The portal's own footer (13 Oct): a black band headed HOW TO CITE with the NSF and Hawaiʻi EPSCoR logos, the
// support statement in the portal's exact words, and the WRRC logo; then the copyright bar. Nothing else.
export const SUPPORT_STATEMENT_A = 'This work is supported by the '
export const SUPPORT_STATEMENT_B = 'National Science Foundation OIA #2149133'
export const SUPPORT_STATEMENT_C = ' and Hawaii EPSCoR- RII Track-1: Change Hawaii: Harnessing the Data Revolution for Island Resilience'

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-16" data-testid="site-footer">
      <div className="bg-black px-4 py-12 text-white">
        <div className="mx-auto w-full max-w-6xl">
          <h2 className="mb-10 text-center font-sans text-[15px] font-bold uppercase tracking-[0.06em]"><Link to="/about/how-to-cite" className="hover:underline">How to Cite</Link></h2>
          <div className="grid items-center gap-8 md:grid-cols-[150px_240px_minmax(0,1fr)_120px] md:gap-10">
            <img src="/footer/nsf.png" alt="National Science Foundation" width="150" height="150" loading="lazy" className="mx-auto h-[118px] w-[118px] md:h-[150px] md:w-[150px]" />
            <img src="/footer/epscor-hawaii.png" alt="Hawaiʻi EPSCoR" width="147" height="49" loading="lazy" className="mx-auto h-auto w-[240px]" />
            <p className="text-center text-[22px] leading-[1.7] text-white/85 md:text-left md:text-[24px]" data-testid="support-statement">
              {SUPPORT_STATEMENT_A}<span className="text-[15px] md:text-[16px]">{SUPPORT_STATEMENT_B}</span>{SUPPORT_STATEMENT_C}
            </p>
            <img src="/footer/wrrc.webp" alt="Water Resources Research Center, University of Hawaiʻi at Mānoa" width="240" height="355" loading="lazy" className="mx-auto h-auto w-[100px] md:w-[120px]" />
          </div>
        </div>
      </div>
      <div className="bg-[#1b1b1b] px-4 py-5 text-center text-[16px] text-white/70" data-testid="copyright">Copyright © {year} Hawaiʻi Climate Data Portal</div>
    </footer>
  )
}
