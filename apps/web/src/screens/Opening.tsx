import { compile } from '@opening/engine'
import { useEffect, useState } from 'react'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'

export function Opening({ id }: { id: string }) {
  const data = useData()
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [confirm, setConfirm] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    void (async () => {
      const found = await data.getOpening(id)
      const stored = found ? await data.listLines(id) : []
      if (!cancel) {
        setOpening(found ?? null)
        setLines(stored)
      }
    })()
    return () => {
      cancel = true
    }
  }, [data, id])

  if (opening === undefined) return <p>Loading…</p>
  if (!opening) return <p>That opening is not on this device.</p>

  const learning = lines.filter((line) => line.included)
  const conflicts = compile(learning, opening.myColor).conflicts
  const groups = new Map<string, LineRecord[]>()
  for (const line of lines) {
    const name = line.groupName || 'Lines'
    groups.set(name, [...(groups.get(name) ?? []), line])
  }

  async function rename(line: LineRecord, name: string, groupName: string) {
    if (name.trim() === line.name && groupName.trim() === line.groupName) return
    await data.updateLine(line.id, { name: name.trim() || line.name, groupName: groupName.trim() || 'Lines' })
  }

  return (
    <div className="stack">
      <BackButton to="/" label="All openings" />
      <label>
        <span>Opening</span>
        <input
          defaultValue={opening.name}
          key={opening.updatedAt}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name && name !== opening.name) void data.updateOpening(opening.id, { name })
          }}
        />
      </label>
      <p className="quiet">{opening.myColor === 'white' ? 'You play White.' : 'You play Black.'}</p>
      {conflicts.map((conflict) => (
        <div className="callout" key={conflict.key}>
          <p>Two lines disagree on your move. Pick the one to practice. The other moves to Later.</p>
          <div className="stack">
            {conflict.options.map((option) => (
              <button
                key={`${option.lineId}-${option.san}`}
                className="btn choice"
                type="button"
                onClick={() => void data.setLineLearning(opening.id, option.lineId, true, opening.myColor)}
              >
                <span>{option.lineName}</span>
                <strong>{option.san}</strong>
              </button>
            ))}
          </div>
        </div>
      ))}
      {lines.length === 0 ? (
        <p className="lede">Add a line by pasting PGN, fetching a Lichess study, or playing the moves.</p>
      ) : null}
      {[...groups.entries()].map(([group, groupLines]) => (
        <section className="stack" key={group}>
          <h2 className="group-title">{group}</h2>
          {groupLines.map((line) => (
            <article className="card stack" key={line.id}>
              <label>
                <span>Line</span>
                <input
                  defaultValue={line.name}
                  onBlur={(event) => void rename(line, event.target.value, line.groupName)}
                />
              </label>
              <label>
                <span>Group</span>
                <input
                  defaultValue={line.groupName}
                  onBlur={(event) => void rename(line, line.name, event.target.value)}
                />
              </label>
              <div className="segment">
                <button
                  type="button"
                  className="btn secondary"
                  aria-pressed={line.included}
                  onClick={() => void data.setLineLearning(opening.id, line.id, true, opening.myColor)}
                >
                  Learning
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  aria-pressed={!line.included}
                  onClick={() => void data.setLineLearning(opening.id, line.id, false, opening.myColor)}
                >
                  Later
                </button>
              </div>
              <div className="actions two">
                <button className="btn secondary" type="button" onClick={() => go(`/o/${opening.id}/study/${line.id}`)}>
                  Study
                </button>
                <button className="btn secondary" type="button" onClick={() => go(`/o/${opening.id}/practice/${line.id}`)}>
                  Practice
                </button>
              </div>
              <button
                className="btn warn"
                type="button"
                onClick={() => {
                  if (confirm === line.id) void data.deleteLine(line.id)
                  else setConfirm(line.id)
                }}
              >
                {confirm === line.id ? 'Confirm remove' : 'Remove'}
              </button>
            </article>
          ))}
        </section>
      ))}
      <button
        className="btn primary"
        type="button"
        disabled={learning.length === 0 || conflicts.length > 0}
        onClick={() => go(`/o/${opening.id}/practice`)}
      >
        Practice what I’m learning
      </button>
      <button className="btn secondary" type="button" onClick={() => go(`/o/${opening.id}/study`)}>
        Study what I’m learning
      </button>
      <button className="btn secondary" type="button" onClick={() => go(`/o/${opening.id}/add`)}>
        Add a line
      </button>
      <button
        className="btn warn"
        type="button"
        onClick={() => {
          if (confirm === 'opening') {
            void data.deleteOpening(opening.id).then(() => go('/'))
          } else setConfirm('opening')
        }}
      >
        {confirm === 'opening' ? 'Confirm remove opening' : 'Remove opening'}
      </button>
    </div>
  )
}
