// Temporary page body until the content agent fills the real one.
export default function Placeholder({ title, blurb, external }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl">{title}</h1>
      {blurb && <p className="mt-2 text-subtle">{blurb}</p>}
      {external && <p className="mt-4 text-sm">Until this page is filled in, the portal's own page is here: <a className="underline" href={external} target="_blank" rel="noopener noreferrer">{external} ↗</a></p>}
    </div>
  )
}
