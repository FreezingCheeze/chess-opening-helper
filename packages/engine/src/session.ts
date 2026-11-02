import { applySan, moveSquares, otherColor, positionKey, sideToMove, START_FEN } from './chess'
import { firstPath, isGenericGroup } from './pgn'
import type { Color, LineInput, PracticeStep, ProgressMark, SessionEvent } from './types'

export type SessionPhase = 'play' | 'wrong' | 'reveal' | 'lineEnd' | 'replay' | 'done'

type Round = {
  lineId: string
  steps: PracticeStep[]
  replay: boolean
}

export type Session = {
  rounds: Round[]
  round: number
  step: number
  phase: SessionPhase
  firstPassMisses: string[]
  replayMisses: string[]
  lineCount: number
  sawReplay: boolean
}

export type SessionResult = {
  session: Session
  events: SessionEvent[]
}

function lineLabel(line: LineInput): string | undefined {
  if (line.groupName && !isGenericGroup(line.groupName) && line.groupName !== line.name) return line.groupName
  if (line.name && line.name !== 'Main line') return line.name
  return undefined
}

export function scriptForLine(line: LineInput, myColor: Color, progress: ProgressMark[]): PracticeStep[] {
  const path = firstPath(line.pgn)
  if (!path) return []
  const steps: PracticeStep[] = []
  let fen = path.startFen
  const label = lineLabel(line)
  for (const move of path.moves) {
    const side = sideToMove(fen)
    const applied = applySan(fen, move.san)
    if (!applied) break
    const base = {
      san: move.san,
      fenBefore: fen,
      fenAfter: applied.fen,
      positionKey: positionKey(fen),
      comment: move.comment,
      lineId: line.id,
    }
    if (side === myColor) {
      const introduced = progress.some(
        (mark) => mark.positionKey === base.positionKey && mark.expectedSan === move.san && mark.introduced,
      )
      if (!introduced) steps.push({ ...base, type: 'introduce' })
      steps.push({ ...base, type: 'ask' })
    } else {
      steps.push({ ...base, type: 'opponent', label })
    }
    fen = applied.fen
  }
  return steps
}

function needsReview(steps: PracticeStep[], progress: ProgressMark[]): boolean {
  return steps.some(
    (step) =>
      step.type === 'ask' &&
      progress.some((mark) => mark.positionKey === step.positionKey && mark.expectedSan === step.san && mark.needsReview),
  )
}

export function createSession(lines: LineInput[], myColor: Color, progress: ProgressMark[]): Session {
  const built = lines
    .map((line) => ({ line, steps: scriptForLine(line, myColor, progress) }))
    .filter((item) => item.steps.length > 0)
  const reviewFirst = [
    ...built.filter((item) => needsReview(item.steps, progress)),
    ...built.filter((item) => !needsReview(item.steps, progress)),
  ]
  const rounds: Round[] = reviewFirst.map((item) => ({ lineId: item.line.id, steps: item.steps, replay: false }))
  return {
    rounds,
    round: 0,
    step: 0,
    phase: rounds.length ? 'play' : 'done',
    firstPassMisses: [],
    replayMisses: [],
    lineCount: rounds.length,
    sawReplay: false,
  }
}

export function currentStep(session: Session): PracticeStep | null {
  if (session.phase === 'done' || session.phase === 'replay') return null
  return session.rounds[session.round]?.steps[session.step] ?? null
}

function finishPass(session: Session): Session {
  if (!session.sawReplay && session.firstPassMisses.length > 0) {
    return { ...session, phase: 'replay' }
  }
  return { ...session, phase: 'done' }
}

function isLastStep(session: Session): boolean {
  const round = session.rounds[session.round]
  return !!round && session.step >= round.steps.length - 1
}

function leaveLine(session: Session): Session {
  const nextRound = session.round + 1
  if (nextRound < session.rounds.length) return { ...session, round: nextRound, step: 0, phase: 'play' }
  return finishPass(session)
}

function advance(session: Session): Session {
  const round = session.rounds[session.round]
  if (!round) return { ...session, phase: 'done' }
  const nextStep = session.step + 1
  if (nextStep < round.steps.length) return { ...session, step: nextStep, phase: 'play' }
  return { ...session, phase: 'lineEnd' }
}

export function next(session: Session): SessionResult {
  const step = currentStep(session)
  if (!step || session.phase !== 'play' || step.type === 'ask') return { session, events: [] }
  const events: SessionEvent[] =
    step.type === 'introduce'
      ? [{ type: 'introduced', positionKey: step.positionKey, san: step.san, lineId: step.lineId }]
      : []
  return { session: advance(session), events }
}

export function answer(session: Session, san: string): SessionResult {
  const step = currentStep(session)
  if (!step || step.type !== 'ask') return { session, events: [] }
  if (session.phase !== 'play' && session.phase !== 'wrong') return { session, events: [] }
  if (san === step.san) {
    return {
      session: advance(session),
      events: [{ type: 'correct', positionKey: step.positionKey, san: step.san, lineId: step.lineId }],
    }
  }
  return { session: { ...session, phase: 'wrong' }, events: [] }
}

export function showMove(session: Session): SessionResult {
  const step = currentStep(session)
  if (!step || step.type !== 'ask') return { session, events: [] }
  if (session.phase !== 'play' && session.phase !== 'wrong') return { session, events: [] }
  return { session: { ...session, phase: 'reveal' }, events: [] }
}

export function continueAfterWrong(session: Session): SessionResult {
  const step = session.rounds[session.round]?.steps[session.step]
  if (session.phase !== 'reveal' || !step) return { session, events: [] }
  const round = session.rounds[session.round]
  const listName = round?.replay ? 'replayMisses' : 'firstPassMisses'
  const list = session[listName]
  const misses = list.includes(step.lineId) ? list : [...list, step.lineId]
  const marked = { ...session, [listName]: misses }
  const events: SessionEvent[] = [{ type: 'miss', positionKey: step.positionKey, san: step.san, lineId: step.lineId }]
  // The revealed move is already on the board. Skip a second pause on that same position.
  if (isLastStep(session)) return { session: leaveLine(marked), events }
  return { session: advance(marked), events }
}

export function continueAfterLine(session: Session): SessionResult {
  if (session.phase !== 'lineEnd') return { session, events: [] }
  return { session: leaveLine(session), events: [] }
}

export function beginReplay(session: Session): Session {
  if (session.phase !== 'replay') return session
  const extras: Round[] = session.firstPassMisses.flatMap((lineId) => {
    const original = session.rounds.find((round) => round.lineId === lineId && !round.replay)
    if (!original) return []
    return [{ lineId, steps: original.steps.filter((step) => step.type !== 'introduce'), replay: true }]
  })
  return {
    ...session,
    rounds: [...session.rounds, ...extras],
    round: session.rounds.length,
    step: 0,
    phase: extras.length ? 'play' : 'done',
    sawReplay: true,
  }
}

export type SessionView = {
  phase: SessionPhase
  prompt: string
  comment?: string
  fen: string
  lastMove?: [string, string]
  interactive: boolean
  expectedSan?: string
  lineId?: string
  missedCount: number
  lineCount: number
}

export function sessionView(session: Session, lines: LineInput[], myColor: Color): SessionView {
  const base = {
    missedCount: session.sawReplay ? session.replayMisses.length : session.firstPassMisses.length,
    lineCount: session.lineCount,
  }
  if (session.phase === 'done') {
    return {
      ...base,
      phase: 'done',
      prompt: 'That’s the end of this practice.',
      fen: (lines[0] && firstPath(lines[0].pgn)?.startFen) || START_FEN,
      interactive: false,
    }
  }
  if (session.phase === 'replay') {
    return {
      ...base,
      phase: 'replay',
      prompt: 'A few lines need another look.',
      fen: '',
      interactive: false,
    }
  }
  const step = currentStep(session)
  const line = lines.find((item) => item.id === step?.lineId)
  if (!step) {
    return { ...base, phase: 'done', prompt: 'That’s the end of this practice.', fen: '', interactive: false }
  }
  const opponent = otherColor(myColor) === 'white' ? 'White' : 'Black'
  const squares = moveSquares(step.fenBefore, step.san)
  const lastMove = squares ? ([squares.from, squares.to] as [string, string]) : undefined
  if (session.phase === 'lineEnd') {
    return {
      ...base,
      phase: 'lineEnd',
      prompt: 'This is the end of the line.',
      comment: step.comment,
      fen: step.fenAfter,
      lastMove,
      interactive: false,
      lineId: step.lineId,
    }
  }
  if (session.phase === 'wrong') {
    return {
      ...base,
      phase: 'wrong',
      prompt: 'That’s not the move in this line.',
      fen: step.fenBefore,
      interactive: true,
      lineId: step.lineId,
    }
  }
  if (session.phase === 'reveal') {
    const ending = isLastStep(session) ? ' This is the end of the line.' : ''
    return {
      ...base,
      phase: 'reveal',
      prompt: `The move in your line is ${step.san}.${ending}`,
      comment: step.comment,
      fen: step.fenAfter,
      lastMove,
      interactive: false,
      expectedSan: step.san,
      lineId: step.lineId,
    }
  }
  if (step.type === 'introduce') {
    return {
      ...base,
      phase: 'play',
      prompt: `Your move here is ${step.san}.`,
      comment: step.comment,
      fen: step.fenAfter,
      lastMove,
      interactive: false,
      expectedSan: step.san,
      lineId: step.lineId,
    }
  }
  if (step.type === 'ask') {
    return {
      ...base,
      phase: 'play',
      prompt: 'Your move',
      fen: step.fenBefore,
      interactive: true,
      expectedSan: step.san,
      lineId: step.lineId,
    }
  }
  const label = step.label || line?.name
  return {
    ...base,
    phase: 'play',
    prompt: label ? `${opponent} plays ${step.san} — ${label}` : `${opponent} plays ${step.san}`,
    comment: step.comment,
    fen: step.fenAfter,
    lastMove,
    interactive: false,
    lineId: step.lineId,
  }
}
