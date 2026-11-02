import { importPgn } from '@opening/engine'
import { useEffect, useState } from 'react'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import { stashDrafts } from '../lib/drafts'
import { go } from '../lib/routes'

export function Paste({ id }: { id: string }) {
  const data = useData()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [color, setColor] = useState<'white' | 'black' | null>(null)

  useEffect(() => {
    void data.getOpening(id).then((opening) => setColor(opening?.myColor ?? null))
  }, [data, id])

  function read() {
    if (!color) return
    const result = importPgn(text, color)
    if (result.error || result.drafts.length === 0) {
      setError(result.error || 'Those moves could not be read.')
      return
    }
    stashDrafts(id, result.drafts, [])
    go(`/o/${id}/review`)
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        read()
      }}
    >
      <BackButton to={`/o/${id}/add`} label="Other ways to add" />
      <h1>Paste PGN</h1>
      <p className="lede">Copy a game or a study export. Every branch becomes its own line, saved for later until you turn it on.</p>
      <label>
        <span>PGN</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} />
      </label>
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="submit">
        Read this PGN
      </button>
    </form>
  )
}
