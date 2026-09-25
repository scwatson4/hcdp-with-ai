import { Link } from 'react-router-dom'
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="font-display text-3xl">That page is not here.</h1>
      <p className="mt-2 text-subtle">Ask the assistant on the <Link className="underline" to="/">home page</Link> and it will find the right place.</p>
    </div>
  )
}
