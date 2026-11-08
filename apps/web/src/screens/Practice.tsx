import {
  answer,
  beginReplay,
  continueAfterLine,
  continueAfterWrong,
  createSession,
  currentStep,
  interpretMove,
  next,
  sessionView,
  showMove,
  variationLines,
  type Session,
  type SessionEvent,
} from '@opening/engine'
import { useEffect, useRef, useState } from 'react'
import { Board, PromotionPicker } from '../components/Board'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'

export function Practice({ id, lineId }: { id: string; lineId?: string }) {
  const data = useData()
  const dataRef = useRef(data)
  dataRef.current = data
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [marks, setMarks] = useState<{ positionKey: string; expectedSan: string; introduced: boolean; needsReview: boolean }[]>([])
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)
  const [epoch, setEpoch] = useState(0)

  function start(
    color: 'white' | 'black',
    selected: LineRecord[],
    nextMarks: { positionKey: string; expectedSan: string; introduced: boolean; needsReview: boolean }[],
  ) {
    setMarks(nextMarks)
    setSession(createSession(selected, color, nextMarks))
    setPending(null)
  }

  useEffect(() => {
    let cancel = false
    void (async () => {
      const api = dataRef.current
      const found = await api.getOpening(id)
      if (!found || cancel) {
        if (!cancel) setOpening(found ?? null)
        return
      }
      const stored = await api.listLines(id)
      const progress = await api.listProgress(id)
      const selected = lineId
        ? stored.filter((line) => line.id === lineId).flatMap((line) => variationLines(line))
        : stored.filter((line) => line.included)
      if (cancel) return
      setOpening(found)
      setLines(selected)
      start(
        found.myColor,
        selected,
        progress.map((mark) => ({
          positionKey: mark.positionKey,
          expectedSan: mark.expectedSan,
          introduced: mark.introduced,
          needsReview: mark.needsReview,
        })),
      )
    })()
    return () => {
      cancel = true
    }
    // Saving a move bumps the data revision. That must not restart the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lineId, data.user?.id])

  useEffect(() => {
    if (!session || !opening) return
    const step = currentStep(session)
    if (session.phase !== 'play' || step?.type !== 'opponent') return
    const timer = window.setTimeout(() => {
      const result = next(session)
      void dataRef.current.applyEvents(opening.id, result.events)
      setSession(result.session)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [opening, session])

  if (opening === undefined || (opening && !session)) return <p>Loading…</p>
  if (!opening || !session) return <p>That opening is not on this device.</p>

  const active = opening
  const activeSession = session
  const view = sessionView(activeSession, lines, active.myColor)
  const line = lines.find((item) => item.id === view.lineId)

  function apply(result: { session: Session; events: SessionEvent[] }) {
    void data.applyEvents(active.id, result.events)
    if (result.events.length) {
      setMarks((current) => {
        const next = current.map((mark) => ({ ...mark }))
        for (const event of result.events) {
          const existing = next.find((mark) => mark.positionKey === event.positionKey && mark.expectedSan === event.san)
          if (existing) {
            existing.introduced = true
            if (event.type === 'correct') existing.needsReview = false
            if (event.type === 'miss') existing.needsReview = true
          } else {
            next.push({
              positionKey: event.positionKey,
              expectedSan: event.san,
              introduced: true,
              needsReview: event.type === 'miss',
            })
          }
        }
        return next
      })
    }
    setSession(result.session)
  }

  function playSan(san: string) {
    const result = answer(activeSession, san)
    setPending(null)
    setEpoch((tick) => tick + 1)
    apply(result)
  }

  function onMove(from: string, to: string, promotion?: string) {
    if (!view.interactive) return
    const result = interpretMove(view.fen, from, to, promotion)
    if (!result) return
    if ('promotion' in result) {
      setPending({ from, to })
      return
    }
    playSan(result.san)
  }

  const step = currentStep(session)

  return (
    <div className="stack">
      <BackButton to={`/o/${id}`} label="Back to opening" />
      {view.phase === 'replay' ? (
        <div className="stack">
          <h1>Another look</h1>
          <p className="prompt">{view.prompt}</p>
          <button className="btn primary" type="button" onClick={() => setSession(beginReplay(activeSession))}>
            Practice those again
          </button>
        </div>
      ) : view.phase === 'done' ? (
        <div className="stack">
          <h1>Practice</h1>
          <p className="prompt">{view.lineCount === 0 ? 'There is nothing to practice yet.' : view.prompt}</p>
          {view.lineCount > 0 ? (
            <p>{view.missedCount === 0 ? 'Every move matched your lines.' : `${view.missedCount} still need another look.`}</p>
          ) : null}
          <button
            className="btn primary"
            type="button"
            onClick={() =>
              start(active.myColor, lines, marks)
            }
          >
            Practice again
          </button>
        </div>
      ) : (
        <div className="stage">
          <Board
            fen={view.fen}
            orientation={active.myColor}
            interactive={view.interactive && !pending}
            preview={view.phase === 'play' && step?.type === 'opponent'}
            epoch={epoch}
            lastMove={view.lastMove}
            onMove={(from, to) => onMove(from, to)}
          />
          <div className="panel stack">
            <h1>{line?.name ?? 'Practice'}</h1>
            <p className="prompt">{view.prompt}</p>
            {view.comment ? <p>{view.comment}</p> : null}
            {pending ? <PromotionPicker onPick={(piece) => onMove(pending.from, pending.to, piece)} /> : null}
            {view.phase === 'play' && step?.type === 'introduce' ? (
              <button
                className="btn primary"
                type="button"
                onClick={() => apply(next(activeSession))}
              >
                Now you play it
              </button>
            ) : null}
            {view.phase === 'play' && step?.type === 'opponent' ? (
              <button className="btn secondary" type="button" onClick={() => apply(next(activeSession))}>
                Continue
              </button>
            ) : null}
            {(view.phase === 'play' || view.phase === 'wrong') && step?.type === 'ask' ? (
              <button className="btn secondary" type="button" onClick={() => apply(showMove(activeSession))}>
                Show move
              </button>
            ) : null}
            {view.phase === 'reveal' ? (
              <button className="btn primary" type="button" onClick={() => apply(continueAfterWrong(activeSession))}>
                Continue
              </button>
            ) : null}
            {view.phase === 'lineEnd' ? (
              <button className="btn primary" type="button" onClick={() => apply(continueAfterLine(activeSession))}>
                Continue
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
