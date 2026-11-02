import {
  commentOnLast,
  editorChoices,
  editorDrafts,
  followChoice,
  interpretMove,
  newEditor,
  placeOf,
  playSan,
  rewindForOpponentTry,
  undoEditor,
  type EditorState,
} from '@opening/engine'
import { useEffect, useState } from 'react'
import { Board, PromotionPicker } from '../components/Board'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import { stashDrafts } from '../lib/drafts'
import type { OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'

const storageKey = (id: string) => `opening-editor:${id}`

function loadEditor(id: string, color: 'white' | 'black'): EditorState {
  const raw = sessionStorage.getItem(storageKey(id))
  if (!raw) return newEditor(color)
  try {
    const parsed = JSON.parse(raw) as EditorState
    if (parsed.myColor === color && parsed.tree && Array.isArray(parsed.path)) return parsed
  } catch {
    // A broken draft should not block a new line.
  }
  return newEditor(color)
}

function lastComment(state: EditorState): string {
  if (state.path.length === 0) return ''
  const parent = { ...state, path: state.path.slice(0, -1) }
  const san = state.path[state.path.length - 1]
  return editorChoices(parent).find((move) => move.san === san)?.comment ?? ''
}

export function Editor({ id }: { id: string }) {
  const data = useData()
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [state, setState] = useState<EditorState | null>(null)
  const [name, setName] = useState('Main line')
  const [group, setGroup] = useState('Lines')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)

  useEffect(() => {
    let cancel = false
    void data.getOpening(id).then((found) => {
      if (cancel) return
      setOpening(found ?? null)
      if (found) {
        const loaded = loadEditor(id, found.myColor)
        setState(loaded)
        setNote(lastComment(loaded))
      }
    })
    return () => {
      cancel = true
    }
  }, [data, id])

  useEffect(() => {
    if (state) sessionStorage.setItem(storageKey(id), JSON.stringify(state))
  }, [id, state])

  if (opening === undefined || (opening && !state)) return <p>Loading…</p>
  if (!opening || !state) return <p>That opening is not on this device.</p>

  const place = placeOf(state)
  const fen = place?.fen ?? ''
  const choices = editorChoices(state)
  const parent = { ...state, path: state.path.slice(0, -1) }
  const siblings = state.path.length ? editorChoices(parent) : []
  const currentSan = state.path[state.path.length - 1]

  function commit(san: string) {
    const next = playSan(state!, san)
    if ('error' in next) {
      setMessage(next.error)
      return
    }
    setState(next)
    setNote(lastComment(next))
    setMessage('')
    setPending(null)
  }

  function onMove(from: string, to: string, promotion?: string) {
    if (!fen) return
    const result = interpretMove(fen, from, to, promotion)
    if (!result) return
    if ('promotion' in result) {
      setPending({ from, to })
      return
    }
    commit(result.san)
  }

  async function save() {
    const drafts = editorDrafts(state!, name, group)
    if (drafts.length === 0) {
      setMessage('Play a few moves first.')
      return
    }
    sessionStorage.removeItem(storageKey(id))
    if (drafts.length === 1) {
      await data.saveDrafts(id, drafts)
      go(`/o/${id}`)
      return
    }
    stashDrafts(id, drafts, [])
    go(`/o/${id}/review`)
  }

  const opponent = opening.myColor === 'white' ? 'Black' : 'White'

  return (
    <div className="stack">
      <BackButton to={`/o/${id}/add`} label="Other ways to add" />
      <div className="stage">
        <Board
          fen={fen}
          orientation={opening.myColor}
          interactive={!pending}
          onMove={(from, to) => onMove(from, to)}
        />
        <div className="panel stack">
          <h1>Build a line</h1>
          <p className="prompt">
            {place?.side === opening.myColor ? 'Your move.' : `${opponent} to move.`}
          </p>
          {message ? <p className="note">{message}</p> : null}
          {pending ? <PromotionPicker onPick={(piece) => onMove(pending.from, pending.to, piece)} /> : null}
          {siblings.length > 1 ? (
            <div className="stack">
              <p>Tries from here</p>
              {siblings.map((move) => (
                <button
                  key={move.san}
                  className={move.san === currentSan ? 'btn choice current' : 'btn choice'}
                  type="button"
                  onClick={() => {
                    const next = followChoice(parent, move.san)
                    setState(next)
                    setNote(lastComment(next))
                  }}
                >
                  <span>{move.comment || opponent}</span>
                  <strong>{move.san}</strong>
                </button>
              ))}
            </div>
          ) : null}
          {choices.length > 0 ? (
            <div className="stack">
              <p>Continue with</p>
              {choices.map((move) => (
                <button
                  key={move.san}
                  className="btn choice"
                  type="button"
                  onClick={() => {
                    const next = followChoice(state, move.san)
                    setState(next)
                    setNote(lastComment(next))
                  }}
                >
                  <span>{move.comment || 'Saved try'}</span>
                  <strong>{move.san}</strong>
                </button>
              ))}
            </div>
          ) : null}
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setState(rewindForOpponentTry(state))
              setMessage(`Play another move for ${opponent}. The first try stays saved.`)
            }}
          >
            Add another try here
          </button>
          <button className="btn secondary" type="button" onClick={() => setState(undoEditor(state))}>
            Undo
          </button>
          <label>
            <span>Note for the last move</span>
            <input
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
                setState(commentOnLast(state, event.target.value))
              }}
            />
          </label>
          <label>
            <span>Line name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>Group</span>
            <input value={group} onChange={(event) => setGroup(event.target.value)} />
          </label>
          <button className="btn primary" type="button" onClick={() => void save()}>
            Save line
          </button>
        </div>
      </div>
    </div>
  )
}
