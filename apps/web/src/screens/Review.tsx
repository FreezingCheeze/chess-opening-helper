import { reconcileLearning, type DraftLine } from '@opening/engine'
import { useEffect, useState } from 'react'
import { BackButton, LearningToggle, MoveList, yourChoiceNote } from '../components/Bits'
import { useData } from '../lib/data'
import { clearDrafts, readDrafts, stashDrafts } from '../lib/drafts'
import type { LineRecord, OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'

export function Review({ id }: { id: string }) {
  const data = useData()
  const stored = readDrafts(id)
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [existing, setExisting] = useState<LineRecord[]>([])
  const [drafts, setDrafts] = useState<DraftLine[]>(stored?.drafts ?? [])
  const [demoted, setDemoted] = useState<string[]>(stored?.demotedExistingIds ?? [])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancel = false
    void (async () => {
      const found = await data.getOpening(id)
      const lines = found ? await data.listLines(id) : []
      if (!cancel) {
        setOpening(found ?? null)
        setExisting(lines)
      }
    })()
    return () => {
      cancel = true
    }
  }, [data, id])

  if (!stored) {
    return (
      <div className="stack">
        <BackButton to={`/o/${id}/add`} label="Add a line" />
        <p>Nothing is waiting to be saved. Paste a line or build one on the board.</p>
      </div>
    )
  }
  if (opening === undefined) return <p>Loading…</p>
  if (!opening) return <p>That opening is not on this device.</p>

  function edit(next: DraftLine[], preferredId: string | null) {
    const result = reconcileLearning(
      next,
      preferredId,
      opening!.myColor,
      existing.map((line) => ({
        id: line.id,
        name: line.name,
        groupName: line.groupName,
        pgn: line.pgn,
        included: line.included,
      })),
    )
    setDrafts(result.drafts)
    setDemoted(result.demotedExistingIds)
    stashDrafts(id, result.drafts, result.demotedExistingIds)
  }

  const demotedNames = existing.filter((line) => demoted.includes(line.id)).map((line) => line.name)

  async function save() {
    if (drafts.length === 0) {
      setError('There are no lines to save.')
      return
    }
    for (const lineId of demoted) await data.updateLine(lineId, { included: false })
    await data.saveDrafts(id, drafts)
    clearDrafts(id)
    go(`/o/${id}`)
  }

  return (
    <div className="stack">
      <BackButton to={`/o/${id}`} label="Back to opening" />
      <h1>Check these lines</h1>
      <p className="lede">Rename them, put them in a group, and turn on only the ones you want to learn now.</p>
      {demotedNames.length > 0 ? (
        <p className="callout">Saving moves {demotedNames.join(', ')} to Later, so you keep one reply.</p>
      ) : null}
      {drafts.map((draft) => (
        <article className="card stack" key={draft.id}>
          <label>
            <span>Line</span>
            <input
              value={draft.name}
              onChange={(event) =>
                edit(
                  drafts.map((item) => (item.id === draft.id ? { ...item, name: event.target.value } : item)),
                  null,
                )
              }
            />
          </label>
          <label>
            <span>Group</span>
            <input
              value={draft.groupName}
              onChange={(event) =>
                edit(
                  drafts.map((item) => (item.id === draft.id ? { ...item, groupName: event.target.value } : item)),
                  null,
                )
              }
            />
          </label>
          <LearningToggle
            included={draft.included}
            onChange={(included) =>
              edit(
                drafts.map((item) => (item.id === draft.id ? { ...item, included } : item)),
                included ? draft.id : null,
              )
            }
          />
          {yourChoiceNote(draft) ? <p className="quiet">{yourChoiceNote(draft)}</p> : null}
          <MoveList pgn={draft.pgn} color={opening.myColor} />
        </article>
      ))}
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="button" onClick={() => void save()}>
        Save lines
      </button>
    </div>
  )
}
