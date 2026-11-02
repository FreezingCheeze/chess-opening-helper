import { readableRows, type Color, type DraftLine } from '@opening/engine'
import { go } from '../lib/routes'

export function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <button className="back" type="button" onClick={() => go(to)}>
      {label}
    </button>
  )
}

export function MoveList({ pgn, color }: { pgn: string; color: Color }) {
  const rows = readableRows(pgn, color)
  if (rows.length === 0) return <p className="quiet">No moves in this line.</p>
  return (
    <ol className="moves">
      {rows.map((row, index) => (
        <li key={`${index}-${row.san}`}>
          <span>{row.who}</span>
          <strong>{row.san}</strong>
          {row.comment ? <em>{row.comment}</em> : null}
        </li>
      ))}
    </ol>
  )
}

export function LearningToggle({
  included,
  onChange,
}: {
  included: boolean
  onChange: (included: boolean) => void
}) {
  return (
    <div className="segment" role="group" aria-label="Study status">
      <button type="button" className="btn secondary" aria-pressed={included} onClick={() => onChange(true)}>
        Learning
      </button>
      <button type="button" className="btn secondary" aria-pressed={!included} onClick={() => onChange(false)}>
        Later
      </button>
    </div>
  )
}

export function yourChoiceNote(draft: DraftLine): string | null {
  if (!draft.yourChoice) return null
  return 'This is another move for you. Only one reply stays in Learning, so practice does not fork.'
}
