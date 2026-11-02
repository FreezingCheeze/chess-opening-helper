import { useEffect, useState } from 'react'
import { useData } from '../lib/data'
import type { OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'

export function Library() {
  const data = useData()
  const [openings, setOpenings] = useState<OpeningRecord[]>([])

  useEffect(() => {
    let cancel = false
    void data.listOpenings().then((rows) => {
      if (!cancel) setOpenings(rows)
    })
    return () => {
      cancel = true
    }
  }, [data])

  return (
    <div className="stack">
      <h1>Your openings</h1>
      {openings.length === 0 ? (
        <p className="lede">Add an opening, then bring in a few lines to learn. Nothing is loaded for you.</p>
      ) : null}
      {openings.map((opening) => (
        <button key={opening.id} className="card btn choice" type="button" onClick={() => go(`/o/${opening.id}`)}>
          <strong>{opening.name}</strong>
          <span>{opening.myColor === 'white' ? 'Playing White' : 'Playing Black'}</span>
        </button>
      ))}
      <button className="btn primary" type="button" onClick={() => go('/new')}>
        Add an opening
      </button>
      <p className="quiet">On a phone, use the browser menu and choose Add to Home Screen.</p>
      <button className="btn quiet" type="button" onClick={() => void data.signOut()}>
        Sign out
      </button>
      <p className="footer-note">Board pieces by Colin M. L. Burnett, via Chessground.</p>
    </div>
  )
}
