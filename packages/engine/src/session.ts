import { applySan, moveSquares, positionKey, sideToMove, START_FEN } from './chess'
import { firstPath } from './pgn'
import { branchParentKey, type BranchPrefs } from './tree'
import type { Color, LineInput, PracticeStep, ProgressMark, SessionEvent } from './types'

export type SessionPhase = 'play' | 'wrong' | 'reveal' | 'replay' | 'done'

type Round = {
  steps: PracticeStep[]
  replay: boolean
}

type Miss = {
  id: string
  san: string
  ask: PracticeStep
  leadIn?: PracticeStep
}

export type PracticeOrder = 'structured' | 'random'

export type PracticeOptions = {
  /** `structured` follows review marks, then the preferred move, then repertoire order. */
  order?: PracticeOrder
  /** Play each line from its first move. Otherwise the next line resumes at the split. */
  fromStart?: boolean
  /** Used to shuffle when `order` is `random`. Defaults to Math.random. */
  rng?: () => number
}

export type Session = {
  rounds: Round[]
  round: number
  step: number
  phase: SessionPhase
  /** True after the current question has already been missed. */
  failed: boolean
  /** True after Show move has drawn the hint for this question. */
  hinted: boolean
  /** `all` is every Learning move. `selection` is a retry of a smaller set. */
  scope: 'all' | 'selection'
  misses: Miss[]
  replayMisses: { id: string; san: string }[]
  lineCount: number
  sawReplay: boolean
  anchorFen: string
  anchorPath: string[]
  anchorStartFen: string
  anchorLastMove?: [string, string]
}

export type SessionResult = {
  session: Session
  events: SessionEvent[]
}

export type PracticeConflict = {
  positionKey: string
  fen: string
  options: { lineId: string; lineName: string; san: string }[]
}

type Edge = {
  san: string
  lineId: string
  lineName: string
  fenBefore: string
  fenAfter: string
  positionKey: string
  byMe: boolean
  needsReview: boolean
  child: Node
}

type Node = {
  fen: string
  path: string[]
  startFen: string
  children: Edge[]
}

type Group = {
  startFen: string
  index: number
  root: Node
}

function emptySession(startFen = START_FEN): Session {
  return {
    rounds: [],
    round: 0,
    step: 0,
    phase: 'done',
    failed: false,
    hinted: false,
    scope: 'all',
    misses: [],
    replayMisses: [],
    lineCount: 0,
    sawReplay: false,
    anchorFen: startFen,
    anchorPath: [],
    anchorStartFen: startFen,
  }
}

function forest(lines: LineInput[], myColor: Color, progress: ProgressMark[]): Group[] {
  const groups: Group[] = []
  for (const line of lines) {
    const path = firstPath(line.pgn)
    if (!path) continue
    let group = groups.find((item) => item.startFen === path.startFen)
    if (!group) {
      group = {
        startFen: path.startFen,
        index: groups.length,
        root: { fen: path.startFen, path: [], startFen: path.startFen, children: [] },
      }
      groups.push(group)
    }
    let node = group.root
    for (const move of path.moves) {
      let edge = node.children.find((child) => child.san === move.san)
      if (!edge) {
        const applied = applySan(node.fen, move.san)
        if (!applied) break
        const byMe = sideToMove(node.fen) === myColor
        const key = positionKey(node.fen)
        const child: Node = {
          fen: applied.fen,
          path: [...node.path, applied.san],
          startFen: group.startFen,
          children: [],
        }
        edge = {
          san: applied.san,
          lineId: line.id,
          lineName: line.name,
          fenBefore: node.fen,
          fenAfter: applied.fen,
          positionKey: key,
          byMe,
          needsReview:
            byMe &&
            progress.some((mark) => mark.positionKey === key && mark.expectedSan === applied.san && mark.needsReview),
          child,
        }
        node.children.push(edge)
      }
      node = edge.child
    }
  }
  return groups
}

function hasReview(edge: Edge): boolean {
  if (edge.needsReview) return true
  return edge.child.children.some(hasReview)
}

function containsReview(node: Node): boolean {
  return node.children.some(hasReview)
}

function conflictsFrom(groups: Group[]): PracticeConflict[] {
  const found: PracticeConflict[] = []
  const visit = (node: Node) => {
    const mine = node.children.filter((edge) => edge.byMe)
    const sans = [...new Set(mine.map((edge) => edge.san))]
    if (sans.length > 1) {
      found.push({
        positionKey: positionKey(node.fen),
        fen: node.fen,
        options: sans.map((san) => {
          const edge = mine.find((item) => item.san === san)!
          return { lineId: edge.lineId, lineName: edge.lineName, san }
        }),
      })
    }
    for (const edge of node.children) visit(edge.child)
  }
  for (const group of groups) visit(group.root)
  return found
}

/** Own Learning replies that disagree at one position. Shared replies count once. */
export function practiceConflicts(lines: LineInput[], myColor: Color): PracticeConflict[] {
  return conflictsFrom(forest(lines, myColor, []))
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const item = copy[index]!
    copy[index] = copy[swap]!
    copy[swap] = item
  }
  return copy
}

function orderedChildren(node: Node, prefs: BranchPrefs, options: PracticeOptions): Edge[] {
  if (options.order === 'random') return shuffle(node.children, options.rng ?? Math.random)
  const preferred = prefs[branchParentKey(node.path)]
  return node.children
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftReview = hasReview(left.edge) ? 0 : 1
      const rightReview = hasReview(right.edge) ? 0 : 1
      if (leftReview !== rightReview) return leftReview - rightReview
      if (leftReview === 1) {
        const leftPreferred = left.edge.san === preferred ? 0 : 1
        const rightPreferred = right.edge.san === preferred ? 0 : 1
        if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred
      }
      return left.index - right.index
    })
    .map((item) => item.edge)
}

function stepFrom(edge: Edge, parent: Node, type: PracticeStep['type']): PracticeStep {
  return {
    type,
    san: edge.san,
    fenBefore: edge.fenBefore,
    fenAfter: edge.fenAfter,
    positionKey: edge.positionKey,
    path: parent.path,
    startFen: parent.startFen,
    lineId: edge.lineId,
  }
}

function flatten(
  lines: LineInput[],
  myColor: Color,
  progress: ProgressMark[],
  prefs: BranchPrefs,
  options: PracticeOptions,
): PracticeStep[] {
  const groups = [...forest(lines, myColor, progress)].sort((left, right) => {
    if (options.order === 'random') return 0
    const leftReview = containsReview(left.root) ? 0 : 1
    const rightReview = containsReview(right.root) ? 0 : 1
    if (leftReview !== rightReview) return leftReview - rightReview
    return left.index - right.index
  })
  const orderedGroups = options.order === 'random' ? shuffle(groups, options.rng ?? Math.random) : groups
  const steps: PracticeStep[] = []
  const walk = (node: Node, asked: Set<string>) => {
    for (const edge of orderedChildren(node, prefs, options)) {
      if (edge.byMe) {
        const id = `${edge.positionKey}\n${edge.san}`
        if (!asked.has(id)) {
          asked.add(id)
          steps.push(stepFrom(edge, node, 'ask'))
        }
        walk(edge.child, asked)
      } else {
        steps.push(stepFrom(edge, node, 'opponent'))
        walk(edge.child, asked)
      }
    }
  }
  for (const group of orderedGroups) walk(group.root, new Set())
  return steps
}

function lineNeedsReview(line: LineInput, myColor: Color, progress: ProgressMark[]): boolean {
  const path = firstPath(line.pgn)
  if (!path) return false
  let fen = path.startFen
  for (const move of path.moves) {
    const byMe = sideToMove(fen) === myColor
    const key = positionKey(fen)
    if (byMe && progress.some((mark) => mark.positionKey === key && mark.expectedSan === move.san && mark.needsReview)) {
      return true
    }
    const applied = applySan(fen, move.san)
    if (!applied) return false
    fen = applied.fen
  }
  return false
}

function stepsForLine(line: LineInput, myColor: Color): PracticeStep[] {
  const path = firstPath(line.pgn)
  if (!path) return []
  const steps: PracticeStep[] = []
  let fen = path.startFen
  const played: string[] = []
  for (const move of path.moves) {
    const applied = applySan(fen, move.san)
    if (!applied) break
    const byMe = sideToMove(fen) === myColor
    steps.push({
      type: byMe ? 'ask' : 'opponent',
      san: applied.san,
      fenBefore: fen,
      fenAfter: applied.fen,
      positionKey: positionKey(fen),
      path: [...played],
      startFen: path.startFen,
      lineId: line.id,
    })
    played.push(applied.san)
    fen = applied.fen
  }
  return steps
}

function separateLines(
  lines: LineInput[],
  myColor: Color,
  progress: ProgressMark[],
  options: PracticeOptions,
): PracticeStep[] {
  const rng = options.rng ?? Math.random
  const ordered =
    options.order === 'random'
      ? shuffle(lines, rng)
      : lines
          .map((line, index) => ({ line, index, review: lineNeedsReview(line, myColor, progress) }))
          .sort((left, right) => {
            if (left.review !== right.review) return left.review ? -1 : 1
            return left.index - right.index
          })
          .map((item) => item.line)
  return ordered.flatMap((line) => stepsForLine(line, myColor))
}

export function scriptForLine(line: LineInput, myColor: Color, progress: ProgressMark[]): PracticeStep[] {
  return flatten([line], myColor, progress, {}, {})
}

function openSession(steps: PracticeStep[], lineCount: number, scope: Session['scope'], startFen: string): Session {
  return {
    rounds: [{ steps, replay: false }],
    round: 0,
    step: 0,
    phase: 'play',
    failed: false,
    hinted: false,
    scope,
    misses: [],
    replayMisses: [],
    lineCount,
    sawReplay: false,
    anchorFen: steps[0]?.startFen ?? startFen,
    anchorPath: [],
    anchorStartFen: steps[0]?.startFen ?? startFen,
  }
}

export function createSession(
  lines: LineInput[],
  myColor: Color,
  progress: ProgressMark[],
  prefs: BranchPrefs = {},
  options: PracticeOptions = {},
): Session {
  const startFen = lines.map((line) => firstPath(line.pgn)?.startFen).find((fen): fen is string => Boolean(fen)) ?? START_FEN
  if (practiceConflicts(lines, myColor).length > 0) return emptySession(startFen)
  const steps = options.fromStart
    ? separateLines(lines, myColor, progress, options)
    : flatten(lines, myColor, progress, prefs, options)
  const asks = steps.filter((step) => step.type === 'ask')
  if (asks.length === 0) return emptySession(startFen)
  return openSession(steps, new Set(asks.map((step) => step.lineId)).size, 'all', startFen)
}

export function currentStep(session: Session): PracticeStep | null {
  if (session.phase === 'done' || session.phase === 'replay') return null
  return session.rounds[session.round]?.steps[session.step] ?? null
}

function missEvent(step: PracticeStep): SessionEvent {
  return { type: 'miss', positionKey: step.positionKey, san: step.san, lineId: step.lineId }
}

function correctEvent(step: PracticeStep): SessionEvent {
  return { type: 'correct', positionKey: step.positionKey, san: step.san, lineId: step.lineId }
}

function rememberMiss(session: Session, step: PracticeStep): Session {
  const id = `${step.positionKey}\n${step.san}`
  const round = session.rounds[session.round]
  if (round?.replay) {
    if (session.replayMisses.some((miss) => miss.id === id)) return { ...session, failed: true }
    return { ...session, failed: true, replayMisses: [...session.replayMisses, { id, san: step.san }] }
  }
  if (session.misses.some((miss) => miss.id === id)) return { ...session, failed: true }
  const previous = round?.steps[session.step - 1]
  const leadIn =
    previous && previous.type === 'opponent' && previous.fenAfter === step.fenBefore ? previous : undefined
  return {
    ...session,
    failed: true,
    misses: [...session.misses, { id, san: step.san, ask: step, leadIn }],
  }
}

function finishStep(session: Session): Session {
  const step = currentStep(session)
  const squares = step ? moveSquares(step.fenBefore, step.san) : null
  const anchored: Session = step
    ? {
        ...session,
        failed: false,
        hinted: false,
        anchorFen: step.fenAfter,
        anchorPath: [...step.path, step.san],
        anchorStartFen: step.startFen,
        anchorLastMove: squares ? [squares.from, squares.to] : undefined,
      }
    : { ...session, failed: false, hinted: false }
  const round = anchored.rounds[anchored.round]
  const nextIndex = anchored.step + 1
  if (round && nextIndex < round.steps.length) return { ...anchored, step: nextIndex, phase: 'play' }
  return { ...anchored, phase: 'done' }
}

export function next(session: Session): SessionResult {
  const step = currentStep(session)
  if (!step || session.phase !== 'play' || step.type !== 'opponent') return { session, events: [] }
  return { session: finishStep(session), events: [] }
}

export function answer(session: Session, san: string): SessionResult {
  const step = currentStep(session)
  if (!step || step.type !== 'ask') return { session, events: [] }
  if (session.phase !== 'play' && session.phase !== 'wrong') return { session, events: [] }
  if (san === step.san) {
    if (session.failed) return { session: finishStep(session), events: [] }
    return { session: finishStep(session), events: [correctEvent(step)] }
  }
  if (session.failed) return { session, events: [] }
  return { session: { ...rememberMiss(session, step), phase: 'wrong' }, events: [missEvent(step)] }
}

export function showMove(session: Session): SessionResult {
  const step = currentStep(session)
  if (!step || step.type !== 'ask') return { session, events: [] }
  if (session.phase !== 'play' && session.phase !== 'wrong') return { session, events: [] }
  if (session.failed) return { session: { ...session, hinted: true, phase: 'play' }, events: [] }
  return { session: { ...rememberMiss(session, step), hinted: true, phase: 'play' }, events: [missEvent(step)] }
}

export function hideMove(session: Session): SessionResult {
  const step = currentStep(session)
  if (!step || step.type !== 'ask' || !session.hinted) return { session, events: [] }
  if (session.phase !== 'play' && session.phase !== 'wrong') return { session, events: [] }
  return { session: { ...session, hinted: false }, events: [] }
}

export function continueAfterWrong(session: Session): SessionResult {
  if (session.phase !== 'reveal') return { session, events: [] }
  return { session: finishStep(session), events: [] }
}

export function beginReplay(session: Session): Session {
  if (session.phase !== 'replay') return session
  const steps = session.misses.flatMap((miss) => {
    if (!miss.leadIn) return [{ ...miss.ask, path: [], startFen: miss.ask.fenBefore }]
    const leadIn: PracticeStep = { ...miss.leadIn, path: [], startFen: miss.leadIn.fenBefore }
    const ask: PracticeStep = { ...miss.ask, path: [miss.leadIn.san], startFen: miss.leadIn.fenBefore }
    return [leadIn, ask]
  })
  if (steps.length === 0) return { ...session, phase: 'done', sawReplay: true }
  return {
    ...session,
    rounds: [...session.rounds, { steps, replay: true }],
    round: session.rounds.length,
    step: 0,
    phase: 'play',
    failed: false,
    hinted: false,
    sawReplay: true,
  }
}

function shortMissSteps(miss: Miss): PracticeStep[] {
  if (!miss.leadIn) return [{ ...miss.ask, path: [], startFen: miss.ask.fenBefore }]
  const leadIn: PracticeStep = { ...miss.leadIn, path: [], startFen: miss.leadIn.fenBefore }
  const ask: PracticeStep = { ...miss.ask, path: [miss.leadIn.san], startFen: miss.leadIn.fenBefore }
  return [leadIn, ask]
}

function stepsFromLineStarts(misses: Miss[], myColor: Color): PracticeStep[] {
  const wanted = new Set(misses.map((miss) => miss.id))
  const groups = new Map<string, Miss[]>()
  for (const miss of misses) {
    const list = groups.get(miss.ask.startFen) ?? []
    list.push(miss)
    groups.set(miss.ask.startFen, list)
  }
  const steps: PracticeStep[] = []
  for (const [startFen, list] of groups) {
    type Branch = { san: string; fen: string; path: string[]; lineId: string; children: Map<string, Branch> }
    const root = { fen: startFen, path: [] as string[], children: new Map<string, Branch>() }
    for (const miss of list) {
      let fen = startFen
      let parent = root
      for (const san of [...miss.ask.path, miss.ask.san]) {
        let child = parent.children.get(san)
        if (!child) {
          const applied = applySan(fen, san)
          if (!applied) break
          child = {
            san,
            fen: applied.fen,
            path: [...parent.path, san],
            lineId: miss.ask.lineId,
            children: new Map(),
          }
          parent.children.set(san, child)
        }
        parent = child
        fen = child.fen
      }
    }
    const walk = (node: { fen: string; path: string[]; children: Map<string, Branch> }) => {
      for (const child of node.children.values()) {
        const byMe = sideToMove(node.fen) === myColor
        const id = `${positionKey(node.fen)}\n${child.san}`
        steps.push({
          type: byMe && wanted.has(id) ? 'ask' : 'opponent',
          san: child.san,
          fenBefore: node.fen,
          fenAfter: child.fen,
          positionKey: positionKey(node.fen),
          path: node.path,
          startFen,
          lineId: child.lineId,
        })
        walk(child)
      }
    }
    walk(root)
  }
  return steps
}

/** Repeat the round that just finished, with a fresh miss list. */
export function retryRound(session: Session): Session {
  const round = session.rounds[session.round]
  if (!round?.steps.length) return session
  const startFen = round.steps[0]?.startFen ?? session.anchorStartFen
  return openSession(round.steps.map((step) => ({ ...step })), session.lineCount, session.scope, startFen)
}

/** Practice the misses from the round that just finished. */
export function retryMisses(session: Session, myColor: Color, options: PracticeOptions = {}): Session {
  if (session.misses.length === 0) return session
  const misses = options.order === 'random' ? shuffle(session.misses, options.rng ?? Math.random) : session.misses
  const steps = options.fromStart ? stepsFromLineStarts(misses, myColor) : misses.flatMap(shortMissSteps)
  if (!steps.some((step) => step.type === 'ask')) return session
  const startFen = steps[0]?.startFen ?? session.anchorStartFen
  return openSession(steps, new Set(session.misses.map((miss) => miss.ask.lineId)).size, 'selection', startFen)
}

export type SessionView = {
  phase: SessionPhase
  prompt: string
  fen: string
  lastMove?: [string, string]
  interactive: boolean
  missedCount: number
  lineCount: number
  progress: { done: number; total: number }
  played: string[]
  startFen: string
}

function progressOf(session: Session): { done: number; total: number } {
  const round = session.rounds[session.round]
  if (!round) return { done: 0, total: 0 }
  const askIndexes = round.steps.flatMap((step, index) => (step.type === 'ask' ? [index] : []))
  const total = askIndexes.length
  if (session.phase === 'done' || session.phase === 'replay') return { done: total, total }
  const completed = askIndexes.filter((index) => index < session.step).length
  const onAsk = round.steps[session.step]?.type === 'ask'
  return { done: onAsk ? completed + 1 : completed, total }
}

function attentionSans(session: Session): string[] {
  const seen = new Set<string>()
  const sans: string[] = []
  for (const miss of session.misses) {
    if (seen.has(miss.san)) continue
    seen.add(miss.san)
    sans.push(miss.san)
  }
  return sans
}

function attentionSentence(sans: string[]): string {
  if (sans.length === 0) return 'Every move matched'
  if (sans.length === 1) return `${sans[0]} still needs attention.`
  if (sans.length === 2) return `${sans[0]} and ${sans[1]} still need attention.`
  return `${sans.slice(0, -1).join(', ')}, and ${sans[sans.length - 1]} still need attention.`
}

function squaresOf(step: PracticeStep): [string, string] | undefined {
  const squares = moveSquares(step.fenBefore, step.san)
  return squares ? [squares.from, squares.to] : undefined
}

export function sessionView(session: Session, _lines?: LineInput[], _myColor?: Color): SessionView {
  const progress = progressOf(session)
  const missedCount = session.sawReplay ? session.replayMisses.length : session.misses.length
  const base = { missedCount, lineCount: session.lineCount, progress }
  if (session.phase === 'done' || session.phase === 'replay') {
    const prompt =
      session.phase === 'replay'
        ? 'A few moves need another look.'
        : session.lineCount === 0
          ? 'There is nothing to practice yet.'
          : attentionSentence(attentionSans(session))
    return {
      ...base,
      phase: session.phase,
      prompt,
      fen: session.anchorFen,
      lastMove: session.anchorLastMove,
      interactive: false,
      played: session.anchorPath,
      startFen: session.anchorStartFen,
    }
  }
  const step = currentStep(session)
  if (!step) {
    return {
      ...base,
      phase: 'done',
      prompt: 'Every move matched',
      fen: session.anchorFen,
      lastMove: session.anchorLastMove,
      interactive: false,
      played: session.anchorPath,
      startFen: session.anchorStartFen,
    }
  }
  const played = (includeMove: boolean) => ({
    played: includeMove ? [...step.path, step.san] : step.path,
    startFen: step.startFen,
  })
  if (session.hinted && step.type === 'ask') {
    return {
      ...base,
      phase: 'play',
      prompt: 'Play the marked move.',
      fen: step.fenBefore,
      interactive: true,
      ...played(false),
    }
  }
  if (session.phase === 'wrong') {
    return {
      ...base,
      phase: 'wrong',
      prompt: 'That’s not the move in this line.',
      fen: step.fenBefore,
      interactive: true,
      ...played(false),
    }
  }
  if (session.phase === 'reveal') {
    return {
      ...base,
      phase: 'reveal',
      prompt: `The move in your line is ${step.san}.`,
      fen: step.fenAfter,
      lastMove: squaresOf(step),
      interactive: false,
      ...played(true),
    }
  }
  if (step.type === 'ask') {
    return {
      ...base,
      phase: 'play',
      prompt: 'Your move',
      fen: step.fenBefore,
      interactive: true,
      ...played(false),
    }
  }
  return {
    ...base,
    phase: 'play',
    prompt: 'Opponent’s move',
    fen: step.fenAfter,
    lastMove: squaresOf(step),
    interactive: false,
    ...played(true),
  }
}
