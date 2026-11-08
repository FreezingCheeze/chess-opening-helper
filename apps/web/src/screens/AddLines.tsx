import {
  allPaths,
  editorChoices,
  editorLines,
  followChoice,
  importPgn,
  interpretMove,
  learningImpact,
  moveSquares,
  newEditor,
  pathNotation,
  placeOf,
  planAdditions,
  playSan,
  retreatEditor,
  START_FEN,
  undoEditor,
  type AdditionItem,
  type Color,
  type EditorState,
} from '@opening/engine'
import { useEffect, useState } from 'react'
import { Board, PromotionPicker } from '../components/Board'
import { MoveStrip } from '../components/MoveStrip'
import { DataError, useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'

export function AddLines({
  opening,
  lines,
  anchor,
  onCancel,
  onSaved,
}: {
  opening: OpeningRecord
  lines: LineRecord[]
  anchor: string[]
  onCancel: () => void
  onSaved: (path: string[]) => void
}) {
  const data = useData()
  const startFen = lines.length ? repertoireStart(lines) : START_FEN
  const [mode, setMode] = useState<'paste' | 'build'>(anchor.length ? 'build' : 'paste')
  const [text, setText] = useState('')
  const [editor, setEditor] = useState(() => editorFromAnchor(opening.myColor, startFen, anchor, lines))
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null)
  const [review, setReview] = useState<AdditionItem[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (mode !== 'build' || review) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setEditor((current) => (current.path.length > anchor.length ? retreatEditor(current) : current))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setEditor((current) => {
          const choices = editorChoices(current)
          if (choices.length !== 1) return current
          return followChoice(current, choices[0].san)
        })
      } else if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor.length, mode, onCancel, review])

  const place = placeOf(editor)
  const choices = editorChoices(editor)
  const impact = review ? impactFor(review, lines, opening.myColor) : null
  const savable = review?.filter((item) => item.kind === 'create' || item.kind === 'extend') ?? []
  const blocked = Boolean(impact && impact.conflicts.length > 0)

  function play(san: string) {
    if (editor.path.length < anchor.length) return
    const next = playSan(editor, san)
    if ('error' in next) {
      setError(next.error)
      return
    }
    setError('')
    setPromo(null)
    setEditor(next)
  }

  function onMove(from: string, to: string, promotion?: string) {
    if (!place || editor.path.length < anchor.length) return
    const result = interpretMove(place.fen, from, to, promotion)
    if (!result) return
    if ('promotion' in result) {
      setPromo({ from, to })
      return
    }
    play(result.san)
  }

  function openReview(items: AdditionItem[], notes: string[]) {
    setWarnings(notes)
    setReview(items)
    setError('')
  }

  function reviewPaste() {
    const parsed = importPgn(text, opening.myColor)
    if (parsed.error) {
      setError(parsed.error)
      setReview(null)
      return
    }
    openReview(planAdditions(lines, parsed.drafts), parsed.warnings ?? [])
  }

  function reviewBuild() {
    const drafts = editorLines(editor, anchor.length, opening.name, 'Lines')
    if (drafts.length === 0) {
      setError('Play the new moves on the board first.')
      return
    }
    openReview(planAdditions(lines, drafts), [])
  }

  function toggleIncluded(id: string, included: boolean) {
    setReview((current) => current?.map((item) => (item.id === id ? { ...item, included } : item)) ?? current)
  }

  async function save() {
    if (!review || !impact || blocked || savable.length === 0) return
    setPending(true)
    setError('')
    try {
      await data.commitLines(opening.id, {
        create: savable
          .filter((item) => item.kind === 'create')
          .map((item) => ({
            name: item.name,
            groupName: item.groupName,
            pgn: item.pgn,
            included: item.included,
          })),
        update: [
          ...savable
            .filter((item) => item.kind === 'extend' && item.existingId)
            .map((item) => ({ id: item.existingId!, pgn: item.pgn, included: item.included })),
          ...impact.demoted.map((line) => ({ id: line.id, included: false as const })),
        ],
      })
      onSaved(savable[0]?.sans ?? anchor)
    } catch (caught) {
      setError(caught instanceof DataError ? caught.message : 'Could not save these lines.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="stack">
      <button className="back" type="button" onClick={onCancel}>
        Cancel
      </button>
      <h1>{anchor.length ? 'Add continuation' : 'Add lines'}</h1>
      {anchor.length ? (
        <p className="quiet">
          Build on board keeps {pathNotation(startFen, anchor)} and adds moves after it. Pasted PGN is checked from the
          start of the opening.
        </p>
      ) : (
        <p className="quiet">Paste PGN, or play moves for both sides on the board. New lines start on Later.</p>
      )}
      <div className="segment" role="group" aria-label="How to add lines">
        <button type="button" className="btn secondary" aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}>
          Paste PGN
        </button>
        <button type="button" className="btn secondary" aria-pressed={mode === 'build'} onClick={() => setMode('build')}>
          Build on board
        </button>
      </div>
      {review ? (
        <div className="stack">
          {warnings.map((warning) => (
            <p key={warning} className="note">
              {warning}
            </p>
          ))}
          <div className="stack">
            {review.map((item) => (
              <article key={item.id} className="card review-item">
                <h2>
                  {item.kind === 'create' ? 'Add' : item.kind === 'extend' ? 'Extend' : item.kind === 'duplicate' ? 'Already saved' : 'Not added'}{' '}
                  {item.name}
                </h2>
                {item.sans.length ? <p>{pathNotation(item.startFen || startFen, item.sans)}</p> : null}
                {item.reason ? <p className="quiet">{item.reason}</p> : null}
                {item.kind === 'extend' ? <p className="quiet">The line keeps its original starting position.</p> : null}
                {item.kind === 'create' || item.kind === 'extend' ? (
                  <div className="segment" role="group" aria-label={`Learning for ${item.name}`}>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-pressed={item.included}
                      onClick={() => toggleIncluded(item.id, true)}
                    >
                      Learning
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-pressed={!item.included}
                      onClick={() => toggleIncluded(item.id, false)}
                    >
                      Later
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {impact && impact.demoted.length > 0 ? (
            <p className="callout">These existing lines will move to Later: {impact.demoted.map((line) => line.name).join(', ')}.</p>
          ) : null}
          {impact && impact.conflicts.length > 0 ? (
            <div className="callout stack">
              <p>These lines are different replies for you in the same position, so they cannot all be Learning.</p>
              {impact.conflicts.map((conflict, index) => (
                <p key={index}>
                  {conflict.choices.map((choice) => `${choice.san} (${choice.names.join(', ')})`).join(' or ')}
                </p>
              ))}
              <p>Leave all but one of those lines on Later.</p>
            </div>
          ) : null}
          {savable.length === 0 ? <p className="quiet">Nothing new to add.</p> : null}
          {error ? <p className="note">{error}</p> : null}
          <div className="confirm-actions">
            <button className="btn secondary" type="button" onClick={() => setReview(null)}>
              Back
            </button>
            <button className="btn primary" type="button" disabled={pending || blocked || savable.length === 0} onClick={() => void save()}>
              {pending ? 'Saving…' : 'Save lines'}
            </button>
          </div>
        </div>
      ) : mode === 'paste' ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            reviewPaste()
          }}
        >
          <label>
            <span>PGN</span>
            <textarea
              value={text}
              autoFocus
              placeholder="1. e4 c6 2. d4 d5 *"
              onChange={(event) => {
                setText(event.target.value)
                if (error) setError('')
              }}
            />
          </label>
          {error ? <p className="note">{error}</p> : null}
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            Review lines
          </button>
        </form>
      ) : (
        <div className="stack">
          <div className="stage">
            <div className="board-side stack">
              <Board
                fen={place?.fen ?? startFen}
                orientation={opening.myColor}
                interactive={Boolean(place) && editor.path.length >= anchor.length && !promo}
                lastMove={lastSquares(editor)}
                onMove={(from, to) => onMove(from, to)}
              />
              {promo ? <PromotionPicker onPick={(piece) => onMove(promo.from, promo.to, piece)} /> : null}
              <div className="board-nav" role="group" aria-label="Draft moves">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={editor.path.length <= anchor.length}
                  onClick={() => setEditor((current) => retreatEditor(current))}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={editor.path.length <= anchor.length}
                  onClick={() => setEditor((current) => undoEditor(current))}
                >
                  Undo move
                </button>
              </div>
              <div className="board-line">
                <p className="board-line-title">{anchor.length ? 'Continuation' : 'New line'}</p>
                <div className="board-line-moves">
                  <MoveStrip
                    startFen={editor.startFen}
                    moves={editor.path}
                    at={editor.path.length}
                    onPick={(index) => {
                      if (index + 1 < anchor.length) return
                      setEditor((current) => ({ ...current, path: current.path.slice(0, index + 1) }))
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="panel stack">
              <p className="quiet">Play a legal move for either side, including promotions. Go back to a split to add an alternative.</p>
              {choices.length > 0 ? (
                <div className="stack">
                  {choices.map((choice) => (
                    <button key={choice.san} className="btn secondary" type="button" onClick={() => setEditor((current) => followChoice(current, choice.san))}>
                      {choice.san}
                      {choice.comment ? ` — ${choice.comment}` : ''}
                    </button>
                  ))}
                </div>
              ) : null}
              {error ? <p className="note">{error}</p> : null}
              <button className="btn primary" type="button" onClick={reviewBuild}>
                Review lines
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function repertoireStart(lines: LineRecord[]): string {
  for (const line of lines) {
    const path = allPaths(line.pgn)[0]
    if (path) return path.startFen
  }
  return START_FEN
}

function editorFromAnchor(color: Color, startFen: string, anchor: string[], lines: LineRecord[]): EditorState {
  let state = newEditor(color, startFen)
  for (let index = 0; index < anchor.length; index += 1) {
    const next = playSan(state, anchor[index], commentAt(lines, anchor, index))
    if ('error' in next) return state
    state = next
  }
  return state
}

function commentAt(lines: LineRecord[], path: string[], index: number): string | undefined {
  for (const line of lines) {
    for (const candidate of allPaths(line.pgn)) {
      if (!path.every((san, ply) => candidate.moves[ply]?.san === san)) continue
      return candidate.moves[index]?.comment
    }
  }
  return undefined
}

function lastSquares(state: EditorState): [string, string] | undefined {
  if (state.path.length === 0) return undefined
  const before = placeOf({ ...state, path: state.path.slice(0, -1) })
  if (!before) return undefined
  const squares = moveSquares(before.fen, state.path[state.path.length - 1] ?? '')
  return squares ? [squares.from, squares.to] : undefined
}

function impactFor(items: AdditionItem[], lines: LineRecord[], color: Color) {
  const savable = items.filter((item) => item.kind === 'create' || item.kind === 'extend')
  const overridden = new Set(savable.filter((item) => item.kind === 'extend' && item.existingId).map((item) => item.existingId!))
  const pool = [
    ...lines
      .filter((line) => !overridden.has(line.id))
      .map((line) => ({
        id: line.id,
        name: line.name,
        groupName: line.groupName,
        pgn: line.pgn,
        included: line.included,
      })),
    ...savable.map((item) => ({
      id: item.kind === 'extend' ? item.existingId! : item.id,
      name: item.name,
      groupName: item.groupName,
      pgn: item.pgn,
      included: item.included,
    })),
  ]
  return learningImpact(
    pool,
    savable.filter((item) => item.included).map((item) => (item.kind === 'extend' ? item.existingId! : item.id)),
    color,
  )
}
