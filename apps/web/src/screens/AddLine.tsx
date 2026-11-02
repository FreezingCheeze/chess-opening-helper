import { BackButton } from '../components/Bits'
import { go } from '../lib/routes'

export function AddLine({ id }: { id: string }) {
  return (
    <div className="stack">
      <BackButton to={`/o/${id}`} label="Back to opening" />
      <h1>Add a line</h1>
      <p className="lede">Bring in a line from the internet, or play it on the board.</p>
      <button className="btn primary" type="button" onClick={() => go(`/o/${id}/paste`)}>
        Paste PGN
      </button>
      <button className="btn secondary" type="button" onClick={() => go(`/o/${id}/lichess`)}>
        Lichess study link
      </button>
      <button className="btn secondary" type="button" onClick={() => go(`/o/${id}/board`)}>
        Build on the board
      </button>
    </div>
  )
}
