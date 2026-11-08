import {
  applySan,
  answer,
  createSession,
  currentStep,
  firstPath,
  interpretMove,
  moveSquares,
  next,
  positionKey,
  practiceConflicts,
  hideMove,
  retryMisses,
  retryRound,
  sessionView,
  showMove,
  sideToMove,
  variationLines,
  type BranchPrefs,
  type PracticeConflict,
  type PracticeOptions,
  type Session,
  type SessionEvent,
} from '@opening/engine'
import { useEffect, useRef, useState } from 'react'
import { Board, PromotionPicker } from '../components/Board'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'

type Mark = { positionKey: string; expectedSan: string; introduced: boolean; needsReview: boolean }

type Status = 'loading' | 'missing' | 'invalid-line' | 'no-learning' | 'no-moves' | 'conflict' | 'setup' | 'ready'

type Picture = {
  fen: string
  lastMove?: [string, string]
  animate: boolean
  line?: { startFen: string; moves: string[] }
}

type PracticeStyle = {
  order: NonNullable<PracticeOptions['order']>
  fromStart: boolean
  immediateContinue: boolean
}

type Drill = 'all' | 'round' | 'missed'

type Trail = {
  startFen: string
  moves: string[]
  at: number
  glide: boolean
}

type ResultNode = {
  key: string
  san: string
  label: string
  path: string[]
  fen: string
  startFen: string
  lastMove?: [string, string]
  result?: 'correct' | 'missed'
  lineName?: string
  children: ResultNode[]
}

const STYLE_KEY = 'opening-trainer.practice-style'
const LINE_PAUSE_MS = 1000
const GLIDE_MS = 300

const PIECE_VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1 } as const
const PIECE_GLYPH = { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } as const
const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const

function loadStyle(): PracticeStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY)
    if (!raw) return { order: 'structured', fromStart: false, immediateContinue: false }
    const parsed = JSON.parse(raw) as Partial<PracticeStyle>
    return {
      order: parsed.order === 'random' ? 'random' : 'structured',
      fromStart: parsed.fromStart === true,
      immediateContinue: parsed.immediateContinue === true,
    }
  } catch {
    return { order: 'structured', fromStart: false, immediateContinue: false }
  }
}

function foldMarks(marks: Mark[], events: SessionEvent[]): Mark[] {
  const nextMarks = marks.map((mark) => ({ ...mark }))
  for (const event of events) {
    const existing = nextMarks.find((mark) => mark.positionKey === event.positionKey && mark.expectedSan === event.san)
    if (existing) {
      existing.introduced = true
      if (event.type === 'correct') existing.needsReview = false
      if (event.type === 'miss') existing.needsReview = true
    } else {
      nextMarks.push({
        positionKey: event.positionKey,
        expectedSan: event.san,
        introduced: true,
        needsReview: event.type === 'miss',
      })
    }
  }
  return nextMarks
}

function moveOf(step: { fenBefore: string; san: string }): [string, string] | undefined {
  const squares = moveSquares(step.fenBefore, step.san)
  return squares ? [squares.from, squares.to] : undefined
}

function fallbackPicture(session: Session): Picture {
  const view = sessionView(session)
  const step = currentStep(session)
  if (!step || session.phase === 'done' || session.phase === 'replay') {
    return { fen: view.fen, lastMove: view.lastMove, animate: false }
  }
  return { fen: step.fenBefore, animate: session.phase !== 'wrong' && !session.hinted }
}

function visibleMoves(session: Session, fen: string): { startFen: string; moves: string[] } {
  if (session.phase === 'done' || session.phase === 'replay') {
    return { startFen: session.anchorStartFen, moves: session.anchorPath }
  }
  const step = currentStep(session)
  if (!step) return { startFen: session.anchorStartFen, moves: session.anchorPath }
  if (fen === step.fenAfter) return { startFen: step.startFen, moves: [...step.path, step.san] }
  return { startFen: step.startFen, moves: step.path }
}

function framesOf(startFen: string, moves: string[]): { fen: string; lastMove?: [string, string] }[] {
  const frames = [{ fen: startFen, lastMove: undefined as [string, string] | undefined }]
  let fen = startFen
  for (const san of moves) {
    const applied = applySan(fen, san)
    if (!applied) break
    frames.push({ fen: applied.fen, lastMove: [applied.from, applied.to] })
    fen = applied.fen
  }
  return frames
}

function plyLabel(startFen: string, ply: number, san: string): string {
  const whiteStarts = sideToMove(startFen) === 'white'
  const whiteMove = whiteStarts ? ply % 2 === 0 : ply % 2 === 1
  const number = Math.floor((ply + (whiteStarts ? 0 : 1)) / 2) + 1
  return whiteMove ? `${number}. ${san}` : ply === 0 ? `${number}... ${san}` : san
}

type PieceColor = 'w' | 'b'
type PieceRole = (typeof PIECE_ORDER)[number]

function tally(fen: string): Record<PieceColor, Record<PieceRole, number>> {
  const counts: Record<PieceColor, Record<PieceRole, number>> = {
    w: { q: 0, r: 0, b: 0, n: 0, p: 0 },
    b: { q: 0, r: 0, b: 0, n: 0, p: 0 },
  }
  for (const char of fen.split(' ')[0] ?? '') {
    const role = char.toLowerCase()
    if (!PIECE_ORDER.includes(role as PieceRole)) continue
    const color: PieceColor = char === char.toUpperCase() ? 'w' : 'b'
    counts[color][role as PieceRole] += 1
  }
  return counts
}

function materialOf(startFen: string, fen: string, myColor: 'white' | 'black'): {
  mine: string[]
  theirs: string[]
  mineColor: 'white' | 'black'
  theirColor: 'white' | 'black'
  text: string
} {
  const start = tally(startFen)
  const now = tally(fen)
  const mine: PieceColor = myColor === 'white' ? 'w' : 'b'
  const theirs: PieceColor = mine === 'w' ? 'b' : 'w'
  const captured = (captor: PieceColor) => {
    const victim: PieceColor = captor === 'w' ? 'b' : 'w'
    return PIECE_ORDER.flatMap((role) =>
      Array.from({ length: Math.max(0, start[victim][role] - now[victim][role]) }, () => PIECE_GLYPH[role]),
    )
  }
  const value = (color: PieceColor) => PIECE_ORDER.reduce((sum, role) => sum + now[color][role] * PIECE_VALUE[role], 0)
  const diff = value(mine) - value(theirs)
  return {
    mine: captured(mine),
    theirs: captured(theirs),
    mineColor: myColor,
    theirColor: myColor === 'white' ? 'black' : 'white',
    text: diff === 0 ? 'Even' : diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`,
  }
}

function coveredLines(session: Session): { done: number; total: number } {
  const round = session.rounds[session.round]
  if (!round) return { done: 0, total: 0 }
  const last = new Map<string, number>()
  round.steps.forEach((step, index) => last.set(step.lineId, index))
  const cursor = session.phase === 'done' || session.phase === 'replay' ? round.steps.length : session.step
  let done = 0
  for (const index of last.values()) if (index < cursor) done += 1
  return { done, total: last.size }
}

function roundScore(session: Session): string {
  const asks = session.rounds[session.round]?.steps.filter((step) => step.type === 'ask').length ?? 0
  const wrong = session.misses.length
  const right = Math.max(0, asks - wrong)
  return `${right} right and ${wrong} wrong.`
}

function outcomesOf(session: Session): Map<string, 'correct' | 'missed'> {
  const missed = new Set(session.misses.map((miss) => miss.id))
  const outcomes = new Map<string, 'correct' | 'missed'>()
  for (const step of session.rounds[session.round]?.steps ?? []) {
    if (step.type !== 'ask') continue
    const id = `${step.positionKey}\n${step.san}`
    outcomes.set(id, missed.has(id) ? 'missed' : 'correct')
  }
  return outcomes
}

function resultTree(lines: LineRecord[], outcomes: Map<string, 'correct' | 'missed'>): ResultNode[] {
  type Mutable = ResultNode & { childMap: Map<string, Mutable> }
  const roots = new Map<string, Mutable>()
  for (const line of lines) {
    const path = firstPath(line.pgn)
    if (!path) continue
    let fen = path.startFen
    let parentMap = roots
    const sans: string[] = []
    for (let index = 0; index < path.moves.length; index += 1) {
      const move = path.moves[index]
      if (!move) break
      const before = fen
      const applied = applySan(fen, move.san)
      if (!applied) break
      sans.push(applied.san)
      let node = parentMap.get(applied.san)
      const result = outcomes.get(`${positionKey(before)}\n${applied.san}`)
      if (!node) {
        node = {
          key: sans.join('|'),
          san: applied.san,
          label: plyLabel(path.startFen, index, applied.san),
          path: [...sans],
          fen: applied.fen,
          startFen: path.startFen,
          lastMove: [applied.from, applied.to],
          result,
          children: [],
          childMap: new Map(),
        }
        parentMap.set(applied.san, node)
      } else if (!node.result && result) node.result = result
      if (index === path.moves.length - 1 && line.name && line.name !== 'Main line' && line.name !== 'Line') {
        node.lineName = line.name
      }
      fen = applied.fen
      parentMap = node.childMap
    }
  }
  const freeze = (map: Map<string, Mutable>): ResultNode[] =>
    [...map.values()].map(({ childMap, ...node }) => ({ ...node, children: freeze(childMap) }))
  return freeze(roots)
}

export function Practice({ id, lineId }: { id: string; lineId?: string }) {
  const data = useData()
  const dataRef = useRef(data)
  dataRef.current = data
  const generation = useRef(0)
  const saveQueue = useRef(Promise.resolve())
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [prefs, setPrefs] = useState<BranchPrefs>({})
  const [marks, setMarks] = useState<Mark[]>([])
  const [conflicts, setConflicts] = useState<PracticeConflict[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [picture, setPicture] = useState<Picture | null>(null)
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const [style, setStyle] = useState<PracticeStyle>(loadStyle)
  const [trail, setTrail] = useState<Trail | null>(null)
  const [summary, setSummary] = useState(false)
  const [holding, setHolding] = useState(false)
  const [prepared, setPrepared] = useState<{ fen: string; from: string; to: string } | null>(null)
  const [drill, setDrill] = useState<Drill>('all')
  const [nudge, setNudge] = useState(0)
  const passedBreak = useRef(false)
  const playedPrep = useRef('')
  const continueRef = useRef<() => void>(() => {})
  const continueReady = useRef(false)
  continueReady.current = false

  function persist(openingId: string, events: SessionEvent[]) {
    if (!events.length) return
    saveQueue.current = saveQueue.current
      .then(() => dataRef.current.applyEvents(openingId, events))
      .catch(() => undefined)
  }

  function apply(result: { session: Session; events: SessionEvent[] }) {
    setMarks((current) => foldMarks(current, result.events))
    setPending(null)
    setSession(result.session)
    if (opening) persist(opening.id, result.events)
  }

  function rememberStyle(next: PracticeStyle) {
    setStyle(next)
    localStorage.setItem(STYLE_KEY, JSON.stringify(next))
  }

  function begin(color: 'white' | 'black', selected: LineRecord[], nextMarks: Mark[], nextPrefs: BranchPrefs, nextStyle: PracticeStyle) {
    const created = createSession(selected, color, nextMarks, nextPrefs, nextStyle)
    if (created.lineCount === 0) {
      setSession(null)
      setPicture(null)
      setTrail(null)
      setStatus('no-moves')
      return
    }
    setPicture(null)
    setPending(null)
    setTrail(null)
    setSummary(false)
    setHolding(false)
    setPrepared(null)
    passedBreak.current = false
    setEpoch(0)
    setSession(created)
    setStatus('ready')
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== ' ' || event.repeat || !continueReady.current) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }
      event.preventDefault()
      continueRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const ticket = ++generation.current
    setStatus('loading')
    setOpening(undefined)
    setSession(null)
    setPicture(null)
    setTrail(null)
    setConflicts([])
    setPending(null)
    setResolveError('')
    let cancel = false
    void (async () => {
      const api = dataRef.current
      const found = await api.getOpening(id)
      if (cancel || ticket !== generation.current) return
      if (!found) {
        setOpening(null)
        setStatus('missing')
        return
      }
      const stored = await api.listLines(id)
      const progress = await api.listProgress(id)
      const storedPrefs = await api.getBranchPrefs(id)
      if (cancel || ticket !== generation.current) return
      if (lineId && !stored.some((line) => line.id === lineId)) {
        setOpening(found)
        setStatus('invalid-line')
        return
      }
      const selected = lineId
        ? stored.filter((line) => line.id === lineId).flatMap((line) => variationLines(line))
        : stored.filter((line) => line.included)
      const nextMarks = progress.map((mark) => ({
        positionKey: mark.positionKey,
        expectedSan: mark.expectedSan,
        introduced: mark.introduced,
        needsReview: mark.needsReview,
      }))
      setOpening(found)
      setLines(selected)
      setPrefs(storedPrefs)
      setMarks(nextMarks)
      if (!lineId && selected.length === 0) {
        setStatus('no-learning')
        return
      }
      const foundConflicts = practiceConflicts(selected, found.myColor)
      if (foundConflicts.length > 0) {
        setConflicts(foundConflicts)
        setStatus('conflict')
        return
      }
      const created = createSession(selected, found.myColor, nextMarks, storedPrefs, loadStyle())
      if (created.lineCount === 0) {
        setStatus('no-moves')
        return
      }
      setStatus('setup')
    })()
    return () => {
      cancel = true
    }
    // Saving a move bumps the data revision. That must not restart the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lineId, data.user?.id])

  useEffect(() => {
    passedBreak.current = false
    playedPrep.current = ''
    if (session?.phase !== 'done') setSummary(false)
  }, [session])

  useEffect(() => {
    if (!session || status !== 'ready' || trail) return
    const step = currentStep(session)
    const view = sessionView(session)
    const playedLine = (target: { startFen: string; path: string[]; san: string }, include: boolean) => ({
      startFen: target.startFen,
      moves: include ? [...target.path, target.san] : target.path,
    })
    let cancel = false
    const timers: number[] = []
    const later = (delay: number, run: () => void) => {
      timers.push(window.setTimeout(() => {
        if (!cancel) run()
      }, delay))
    }
    const release = () => {
      passedBreak.current = true
      setNudge((value) => value + 1)
    }
    if (!step || session.phase === 'done' || session.phase === 'replay') {
      setPicture({ fen: view.fen, lastMove: view.lastMove, animate: false, line: { startFen: view.startFen, moves: view.played } })
      if (!summary && style.immediateContinue) later(LINE_PAUSE_MS, () => setSummary(true))
      return () => {
        cancel = true
        for (const timer of timers) window.clearTimeout(timer)
      }
    }
    if (session.phase === 'wrong' || session.hinted) {
      setPicture({ fen: step.fenBefore, animate: false, line: playedLine(step, false) })
      return
    }
    const previous = session.rounds[session.round]?.steps[session.step - 1]
    const continuous = Boolean(previous && previous.fenAfter === step.fenBefore)
    if (previous && !continuous && !passedBreak.current) {
      setPicture({ fen: previous.fenAfter, lastMove: moveOf(previous), animate: false, line: playedLine(previous, true) })
      if (!holding) setHolding(true)
      if (style.immediateContinue) later(LINE_PAUSE_MS, release)
      return () => {
        cancel = true
        for (const timer of timers) window.clearTimeout(timer)
      }
    }
    if (holding) setHolding(false)
    if (step.type === 'ask') {
      const lead = previous && previous.fenAfter === step.fenBefore ? moveOf(previous) : undefined
      setPicture({ fen: step.fenBefore, lastMove: lead, animate: continuous, line: playedLine(step, false) })
    } else {
      const before = previous && previous.fenAfter === step.fenBefore ? moveOf(previous) : undefined
      setPicture({ fen: step.fenBefore, lastMove: before, animate: false, line: playedLine(step, false) })
      later(0, () => {
        requestAnimationFrame(() => {
          if (cancel) return
          setPicture({ fen: step.fenAfter, lastMove: moveOf(step), animate: true, line: playedLine(step, true) })
          later(GLIDE_MS + 40, () => apply(next(session)))
        })
      })
    }
    return () => {
      cancel = true
      for (const timer of timers) window.clearTimeout(timer)
    }
    // The timer must follow this session only. A progress save re-renders without changing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, trail, nudge, summary, style.immediateContinue])

  useEffect(() => {
    if (!prepared || !session || trail || status !== 'ready') return
    const step = currentStep(session)
    if (!step || step.type !== 'ask' || (session.phase !== 'play' && session.phase !== 'wrong')) return
    if (prepared.fen !== step.fenBefore) {
      setPrepared(null)
      return
    }
    const key = `${prepared.fen}:${prepared.from}${prepared.to}`
    if (playedPrep.current === key) return
    playedPrep.current = key
    const move = prepared
    setPrepared(null)
    const result = interpretMove(step.fenBefore, move.from, move.to)
    if (!result) return
    if ('promotion' in result) {
      setPending({ from: move.from, to: move.to })
      return
    }
    const answered = answer(session, result.san)
    if (answered.session.phase === 'wrong') setEpoch((tick) => tick + 1)
    apply(answered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, session, trail, status])

  async function keepMove(lineToKeep: string) {
    if (!opening || resolving) return
    const ticket = generation.current
    setResolving(true)
    setResolveError('')
    try {
      await data.setLineLearning(opening.id, lineToKeep, true, opening.myColor)
      if (ticket !== generation.current) return
      const stored = await data.listLines(opening.id)
      const selected = lineId ? stored.filter((line) => line.id === lineId) : stored.filter((line) => line.included)
      setLines(selected)
      const nextConflicts = practiceConflicts(selected, opening.myColor)
      if (nextConflicts.length > 0) {
        setConflicts(nextConflicts)
        setStatus('conflict')
        return
      }
      begin(opening.myColor, selected, marks, prefs, style)
    } catch {
      if (ticket === generation.current) setResolveError('Could not update those lines.')
    } finally {
      if (ticket === generation.current) setResolving(false)
    }
  }

  if (status === 'loading' || opening === undefined) return <p>Loading…</p>
  if (status === 'missing' || !opening) {
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <p>That opening is not on this device.</p>
      </div>
    )
  }
  if (status === 'invalid-line') {
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <p>That line is not in this opening.</p>
      </div>
    )
  }
  if (status === 'no-learning') {
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <p>Turn on Learning for a line before practicing.</p>
      </div>
    )
  }
  if (status === 'no-moves') {
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <p>There is no move of yours to practice.</p>
      </div>
    )
  }
  if (status === 'conflict') {
    const conflict = conflicts[0]
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <div className="stage">
          {conflict ? (
            <Board fen={conflict.fen} orientation={opening.myColor} interactive={false} />
          ) : (
            <div />
          )}
          <div className="panel stack practice-panel">
            <p className="prompt">Choose your move</p>
            <p>These lines disagree here. The other replies will be set aside.</p>
            {conflict?.options.map((option) => (
              <button
                key={`${option.lineId}-${option.san}`}
                className="btn choice"
                type="button"
                disabled={resolving}
                onClick={() => void keepMove(option.lineId)}
              >
                <span>{option.lineName}</span>
                <strong>{option.san}</strong>
              </button>
            ))}
            {resolveError ? <p className="note">{resolveError}</p> : null}
          </div>
        </div>
      </div>
    )
  }

  if (status === 'setup') {
    const startFen = lines.map((line) => firstPath(line.pgn)?.startFen).find((fen): fen is string => Boolean(fen))
    return (
      <div className="stack">
        <BackButton to={`/o/${id}`} label="Back to opening" />
        <div className="stage">
          <div className="board-side stack">
            <Board fen={startFen ?? ''} orientation={opening.myColor} interactive={false} />
          </div>
          <div className="panel stack practice-panel">
            <p className="prompt">How should this practice run?</p>
            <StyleChoices style={style} onChange={rememberStyle} />
            <button className="btn primary" type="button" onClick={() => begin(opening.myColor, lines, marks, prefs, style)}>
              Start practice
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!session) return <p>Loading…</p>

  const active = opening
  const activeSession = session
  const view = sessionView(activeSession)
  const livePicture = picture ?? fallbackPicture(activeSession)
  const liveLine = livePicture.line ?? visibleMoves(activeSession, livePicture.fen)
  const line = trail ?? { startFen: liveLine.startFen, moves: liveLine.moves, at: liveLine.moves.length, glide: false }
  const frame = framesOf(line.startFen, line.moves)[line.at] ?? framesOf(line.startFen, line.moves).at(-1)
  const shown = trail && frame
    ? { fen: frame.fen, lastMove: frame.lastMove, animate: trail.glide }
    : livePicture
  const step = currentStep(activeSession)
  const asking = !trail && !holding && (view.phase === 'play' || view.phase === 'wrong') && step?.type === 'ask'
  const preparing = !trail && !holding && step?.type === 'opponent' && shown.fen === step.fenAfter
  const hint = asking && activeSession.hinted ? moveOf(step) : undefined
  const score = materialOf(line.startFen, shown.fen, active.myColor)
  const done = view.phase === 'done'
  const atLineEnd = holding || (done && !summary)
  const lineProgress = coveredLines(activeSession)
  const showResults = done && summary
  const drillChoices: { id: Drill; label: string }[] = [
    { id: 'all', label: 'All learning moves' },
    ...(activeSession.scope === 'selection' ? [{ id: 'round' as const, label: 'This round' }] : []),
    ...(activeSession.misses.length > 0 ? [{ id: 'missed' as const, label: 'Missed moves' }] : []),
  ]
  const selectedDrill = drillChoices.some((choice) => choice.id === drill) ? drill : 'all'

  function playSan(san: string) {
    const result = answer(activeSession, san)
    if (result.session.phase === 'wrong') setEpoch((tick) => tick + 1)
    apply(result)
  }

  function onMove(from: string, to: string, promotion?: string) {
    if (!view.interactive || trail) return
    const result = interpretMove(shown.fen, from, to, promotion)
    if (!result) return
    if ('promotion' in result) {
      setPending({ from, to })
      return
    }
    playSan(result.san)
  }

  function showAt(moves: string[], startFen: string, at: number, glide: boolean) {
    const end = framesOf(startFen, moves).length - 1
    const nextAt = Math.max(0, Math.min(at, end))
    if (!trail && nextAt === liveLine.moves.length && startFen === liveLine.startFen && moves.join(' ') === liveLine.moves.join(' ')) {
      setTrail(null)
      return
    }
    if (nextAt === end && startFen === liveLine.startFen && moves.join(' ') === liveLine.moves.join(' ')) {
      setTrail(null)
      return
    }
    setTrail({ startFen, moves, at: nextAt, glide })
  }

  function stepBy(delta: number) {
    const moves = trail?.moves ?? liveLine.moves
    const startFen = trail?.startFen ?? liveLine.startFen
    const at = trail?.at ?? moves.length
    const nextAt = at + delta
    const sameAsLive = startFen === liveLine.startFen && moves.join(' ') === liveLine.moves.join(' ')
    if (trail && nextAt >= moves.length && !sameAsLive) {
      setTrail(null)
      return
    }
    showAt(moves, startFen, nextAt, true)
  }

  function startAgain(kind: 'all' | 'round' | 'missed') {
    const next =
      kind === 'all'
        ? createSession(lines, active.myColor, marks, prefs, style)
        : kind === 'round'
          ? retryRound(activeSession)
          : retryMisses(activeSession, active.myColor, style)
    if (next === activeSession || next.phase !== 'play') return
    setPicture(null)
    setPending(null)
    setTrail(null)
    setSummary(false)
    setHolding(false)
    setPrepared(null)
    passedBreak.current = false
    setEpoch(0)
    setSession(next)
  }

  function continueLine() {
    if (done) {
      setSummary(true)
      return
    }
    passedBreak.current = true
    setNudge((value) => value + 1)
  }

  continueReady.current = atLineEnd && !style.immediateContinue
  continueRef.current = continueLine

  const tree = done ? resultTree(lines, outcomesOf(activeSession)) : []
  const canBack = (trail?.at ?? liveLine.moves.length) > 0
  const canForward = trail !== null

  return (
    <div className="stack">
      <BackButton to={`/o/${id}`} label="Back to opening" />
      <div className="stage">
        <div className="board-side stack">
          <Captured label="Opponent took" pieces={score.theirs} color={score.mineColor} />
          <div className="board-and-eval">
            <Board
              fen={shown.fen}
              orientation={active.myColor}
              interactive={view.interactive && !pending && !trail && !atLineEnd}
              preview={preparing}
              animate={shown.animate}
              epoch={epoch}
              lastMove={shown.lastMove}
              arrow={hint}
              onPreviewMove={(from, to) => setPrepared({ fen: shown.fen, from, to })}
              onMove={(from, to) => onMove(from, to)}
            />
            <div className="eval-stack">
              <ContinueChoice style={style} onChange={rememberStyle} />
              <p className="eval-badge" aria-label={`Evaluation: ${score.text}`}>Evaluation: {score.text}</p>
            </div>
          </div>
          <Captured label="You took" pieces={score.mine} color={score.theirColor} />
          <div className="board-nav" role="group" aria-label="Move history">
            <button type="button" className="btn secondary" aria-label="Previous move" disabled={!canBack} onClick={() => stepBy(-1)}>
              ←
            </button>
            <button type="button" className="btn secondary" aria-label="Next move" disabled={!canForward} onClick={() => stepBy(1)}>
              →
            </button>
          </div>
          {line.moves.length > 0 ? (
            <div className="board-line compact">
              <MoveLine
                startFen={line.startFen}
                moves={line.moves}
                at={trail?.at ?? line.moves.length}
                onPick={(ply) => showAt(line.moves, line.startFen, ply + 1, false)}
              />
            </div>
          ) : null}
        </div>
        <div className="panel stack practice-panel">
          {!showResults ? (
            <p className="practice-count" aria-label={`Lines covered ${lineProgress.done} of ${lineProgress.total}`}>
              Lines covered {lineProgress.done} / {lineProgress.total}
            </p>
          ) : null}
          <p className="prompt" role="status">
            {atLineEnd ? 'End of line' : showResults ? roundScore(activeSession) : view.prompt}
          </p>
          {pending ? <PromotionPicker onPick={(piece) => onMove(pending.from, pending.to, piece)} /> : null}
          {atLineEnd && !style.immediateContinue ? (
            <button className="btn primary" type="button" onClick={continueLine}>
              Continue
            </button>
          ) : null}
          {asking && !activeSession.hinted ? (
            <button className="btn secondary" type="button" onClick={() => apply(showMove(activeSession))}>
              Show move
            </button>
          ) : null}
          {asking && activeSession.hinted ? (
            <button className="btn secondary" type="button" onClick={() => apply(hideMove(activeSession))}>
              Hide move
            </button>
          ) : null}
          {showResults ? (
            <>
              <StyleChoices style={style} onChange={rememberStyle} continueChoice={false} />
              <div className="stack">
                <p className="quiet">Practice moves</p>
                <div className={`segment${drillChoices.length === 3 ? ' three' : drillChoices.length === 1 ? ' one' : ''}`} role="group" aria-label="Practice moves">
                  {drillChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className="btn secondary"
                      aria-pressed={selectedDrill === choice.id}
                      onClick={() => setDrill(choice.id)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <button className="btn primary" type="button" onClick={() => startAgain(selectedDrill)}>
                  Practice
                </button>
              </div>
              {tree.length > 0 ? (
                <div className="tree-scroll">
                  <ul className="tree" role="tree" aria-label="Learning lines">
                    <ResultRows nodes={tree} onPick={(node) => showAt(node.path, node.startFen, node.path.length, false)} />
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StyleChoices({
  style,
  onChange,
  continueChoice = true,
}: {
  style: PracticeStyle
  onChange: (style: PracticeStyle) => void
  continueChoice?: boolean
}) {
  return (
    <>
      <div className="stack">
        <p className="quiet">Order</p>
        <div className="segment" role="group" aria-label="Order">
          <button
            type="button"
            className="btn secondary"
            aria-pressed={style.order === 'structured'}
            onClick={() => onChange({ ...style, order: 'structured' })}
          >
            Repertoire order
          </button>
          <button
            type="button"
            className="btn secondary"
            aria-pressed={style.order === 'random'}
            onClick={() => onChange({ ...style, order: 'random' })}
          >
            Random lines
          </button>
        </div>
      </div>
      <div className="stack">
        <p className="quiet">Where the next line starts</p>
        <div className="segment" role="group" aria-label="Where the next line starts">
          <button
            type="button"
            className="btn secondary"
            aria-pressed={!style.fromStart}
            onClick={() => onChange({ ...style, fromStart: false })}
          >
            From the split
          </button>
          <button
            type="button"
            className="btn secondary"
            aria-pressed={style.fromStart}
            onClick={() => onChange({ ...style, fromStart: true })}
          >
            From the start
          </button>
        </div>
      </div>
      {continueChoice ? <ContinueChoice style={style} onChange={onChange} /> : null}
    </>
  )
}

function ContinueChoice({ style, onChange }: { style: PracticeStyle; onChange: (style: PracticeStyle) => void }) {
  return (
    <label className="check-line">
      <input
        type="checkbox"
        checked={style.immediateContinue}
        onChange={(event) => onChange({ ...style, immediateContinue: event.target.checked })}
      />
      Immediately continue to the next line
    </label>
  )
}

function Captured({ label, pieces, color }: { label: string; pieces: string[]; color: 'white' | 'black' }) {
  return (
    <div className="taken-row">
      <span>{label}</span>
      <span className="material-pieces">
        {pieces.length === 0 ? <span className="quiet">—</span> : pieces.map((glyph, index) => (
          <span key={`${glyph}-${index}`} className={color}>{glyph}</span>
        ))}
      </span>
    </div>
  )
}

function MoveLine({
  startFen,
  moves,
  at,
  onPick,
}: {
  startFen: string
  moves: string[]
  at: number
  onPick: (ply: number) => void
}) {
  return (
    <p className="board-line-moves">
      {moves.map((san, ply) => {
        const className = ply === at - 1 ? 'board-ply current' : ply < at ? 'board-ply played' : 'board-ply ahead'
        return (
          <button key={`${ply}-${san}`} type="button" className={className} onClick={() => onPick(ply)}>
            {plyLabel(startFen, ply, san)}
          </button>
        )
      })}
    </p>
  )
}

function ResultRows({ nodes, onPick }: { nodes: ResultNode[]; onPick: (node: ResultNode) => void }) {
  return (
    <>
      {nodes.map((node) => (
        <li key={node.key} role="none">
          <div className="tree-row" style={{ paddingLeft: 8 + (node.path.length - 1) * 18 }}>
            <span className="tree-twist" aria-hidden="true">{node.children.length > 0 ? '▾' : ''}</span>
            <button type="button" role="treeitem" className="tree-pick" onClick={() => onPick(node)}>
              <span className="tree-san">{node.label}</span>
              {node.lineName ? <span className="tree-label">{node.lineName}</span> : null}
              {node.result === 'correct' ? <span className="tree-label correct">Correct</span> : null}
              {node.result === 'missed' ? <span className="tree-label missed">Missed</span> : null}
            </button>
          </div>
          {node.children.length > 0 ? (
            <ul className="tree" role="group">
              <ResultRows nodes={node.children} onPick={onPick} />
            </ul>
          ) : null}
        </li>
      ))}
    </>
  )
}
