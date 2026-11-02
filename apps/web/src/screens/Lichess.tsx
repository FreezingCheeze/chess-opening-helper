import { importPgn, lichessStudyId } from '@opening/engine'
import { useEffect, useState } from 'react'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import { stashDrafts } from '../lib/drafts'
import { go } from '../lib/routes'

export function Lichess({ id }: { id: string }) {
  const data = useData()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [color, setColor] = useState<'white' | 'black' | null>(null)

  useEffect(() => {
    void data.getOpening(id).then((opening) => setColor(opening?.myColor ?? null))
  }, [data, id])

  async function fetchStudy() {
    if (!color) return
    const studyId = lichessStudyId(url)
    if (!studyId) {
      setError('Paste a Lichess study link.')
      return
    }
    setPending(true)
    setError('')
    try {
      const response = await fetch(`https://lichess.org/api/study/${studyId}.pgn`)
      if (!response.ok) throw new Error('That study is not public, or the link is wrong.')
      const pgn = await response.text()
      const result = importPgn(pgn, color)
      if (result.error || result.drafts.length === 0) throw new Error(result.error || 'That study has no moves.')
      stashDrafts(id, result.drafts, [])
      go(`/o/${id}/review`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not fetch that study.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        void fetchStudy()
      }}
    >
      <BackButton to={`/o/${id}/add`} label="Other ways to add" />
      <h1>Lichess study</h1>
      <p className="lede">Public studies only. Each chapter becomes a group, and you choose which lines to learn.</p>
      <label>
        <span>Study link</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://lichess.org/study/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Fetching…' : 'Fetch study'}
      </button>
    </form>
  )
}
