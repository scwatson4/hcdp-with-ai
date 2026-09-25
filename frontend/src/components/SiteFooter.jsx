import { Link } from 'react-router-dom'
import { HCDP, ATLASES } from '../site/nav'

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 text-sm md:grid-cols-3">
        <div>
          <h3 className="mb-2 font-display text-lg">Climate Resources</h3>
          <ul className="space-y-1">
            {ATLASES.map((a) => <li key={a.label}><a className="text-subtle hover:text-foreground" href={a.external} target="_blank" rel="noopener noreferrer">{a.label} ↗</a></li>)}
            <li><Link className="text-subtle hover:text-foreground" to="/pacific">American Samoa Climate Data Portal</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-display text-lg">How to cite</h3>
          <p className="text-subtle">Please cite the data products and the portal when you use them. The citations for every product are on the <Link className="underline" to="/about/how-to-cite">How to Cite</Link> page.</p>
        </div>
        <div>
          <h3 className="mb-2 font-display text-lg">Contact</h3>
          <p className="text-subtle">Hawaiʻi Climate Data Portal, University of Hawaiʻi at Mānoa. <a className="underline" href={`${HCDP}/contact/`} target="_blank" rel="noopener noreferrer">Contact and external resources ↗</a></p>
          <p className="mt-3 text-xs text-subtle">This work is supported by the National Science Foundation OIA #2149133 and Hawaiʻi EPSCoR RII Track-1: Change Hawaiʻi: Harnessing the Data Revolution for Island Resilience.</p>
        </div>
      </div>
      <div className="border-t border-border px-4 py-3 text-center text-xs text-subtle">Prototype: the assistant takes you to HCDP's tools. It does not analyse data itself; for that it hands you to the HCDP AI interface.</div>
    </footer>
  )
}
