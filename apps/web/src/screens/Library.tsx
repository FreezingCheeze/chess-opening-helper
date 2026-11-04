import { useData } from '../lib/data'
import { go } from '../lib/routes'
import { useLoad } from '../lib/useLoad'

function lineLabel(count: number): string {
  return count === 1 ? '1 line' : `${count} lines`
}

export function Library() {
  const data = useData()
  const openings = useLoad(
    () => data.listOpeningSummaries(),
    [data.user?.id, data.revision, data],
  )

  return (
    <div className="stack">
      <div className="library-head">
        <h1>Your openings</h1>
        {openings && openings.length > 0 ? (
          <button className="btn primary library-add" type="button" onClick={() => go('/new')}>
            Add an opening
          </button>
        ) : null}
      </div>
      {openings === undefined ? null : openings.length === 0 ? (
        <>
          <p className="lede">Add an opening, then bring in a few lines to learn.</p>
          <button className="btn primary" type="button" onClick={() => go('/new')}>
            Add an opening
          </button>
        </>
      ) : (
        openings.map((opening) => (
          <button key={opening.id} className="btn choice" type="button" onClick={() => go(`/o/${opening.id}`)}>
            <strong>{opening.name}</strong>
            <span>
              {opening.myColor === 'white' ? 'White' : 'Black'} · {lineLabel(opening.lineCount)}
            </span>
          </button>
        ))
      )}
    </div>
  )
}
