import { studyView } from '@opening/engine'
import { useEffect, useState } from 'react'
import { Board } from '../components/Board'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'

export function Study({ id, lineId }: { id: string; lineId?: string }) {
  const data = useData()
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [path, setPath] = useState<string[]>([])
  const [follow, setFollow] = useState<string | undefined>(lineId)

  useEffect(() => {
    let cancel = false
    void (async () => {
      const found = await data.getOpening(id)
      const stored = found ? await data.listLines(id) : []
      if (cancel) return
      setOpening(found ?? null)
      const focus = lineId ? stored.filter((line) => line.id === lineId || line.included) : stored.filter((line) => line.included)
      setLines(focus)
    })()
    return () => {
      cancel = true
    }
  }, [data, id, lineId])

  if (opening === undefined) return <p>Loading…</p>
  if (!opening) return <p>That opening is not on this device.</p>
  if (lines.length === 0) {
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <p>Turn on a line, or open Study from a single line, before stepping through it.</p>
      </div>
    )
  }

  const view = studyView(lines, opening.myColor, path, follow)

  function step(san: string, nextLineId?: string) {
    setPath((current) => [...current, san])
    if (nextLineId) setFollow(nextLineId)
  }

  const forwardLabel = !view.continueSan
    ? 'Forward'
    : view.youToMove
      ? `Play ${view.continueSan}`
      : view.continueLabel
        ? `${view.continueLabel} — ${view.continueSan}`
        : view.continueSan

  return (
    <div className="stack">
      <BackButton to={`/o/${id}`} label="Back to opening" />
      <div className="stage">
        <Board fen={view.fen} orientation={opening.myColor} interactive={false} lastMove={view.lastMove} />
        <div className="panel stack">
          <h1>{lineId ? lines.find((line) => line.id === lineId)?.name ?? 'Study' : 'Study'}</h1>
          <p className="prompt">{view.prompt}</p>
          {view.comment ? <p className="comment">{view.comment}</p> : null}
          {view.branches.length > 1 ? (
            <div className="stack">
              {view.branches.map((branch) => (
                <button
                  key={`${branch.lineId}-${branch.san}`}
                  className="btn choice"
                  type="button"
                  onClick={() => step(branch.san, branch.lineId)}
                >
                  <span>{branch.label}</span>
                  <strong>{branch.san}</strong>
                </button>
              ))}
            </div>
          ) : view.continueSan ? (
            <button className="btn primary" type="button" onClick={() => step(view.continueSan!, view.continueLineId)}>
              {forwardLabel}
            </button>
          ) : (
            <p>End of the line.</p>
          )}
          <button className="btn secondary" type="button" disabled={path.length === 0} onClick={() => setPath((current) => current.slice(0, -1))}>
            Back
          </button>
        </div>
      </div>
    </div>
  )
}
