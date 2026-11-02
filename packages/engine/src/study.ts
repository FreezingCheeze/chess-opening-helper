import { applySan, moveSquares, otherColor, positionKey, sideToMove, START_FEN } from './chess'
import { compile } from './compile'
import { allPaths, firstPath, isGenericGroup } from './pgn'
import type { Color, LineInput, MoveRecord } from './types'

export type StudyBranch = {
  san: string
  label: string
  lineId: string
  comment?: string
}

export type StudyView = {
  fen: string
  valid: boolean
  youToMove: boolean
  prompt: string
  comment?: string
  branches: StudyBranch[]
  continueSan?: string
  continueLabel?: string
  continueLineId?: string
  finished: boolean
  lastMove?: [string, string]
}

function labelFor(record: MoveRecord): string {
  if (record.groupName && !isGenericGroup(record.groupName)) return record.groupName
  return record.lineName
}

function uniqueBySan(records: MoveRecord[]): StudyBranch[] {
  const branches: StudyBranch[] = []
  for (const record of records) {
    if (branches.some((branch) => branch.san === record.san)) continue
    branches.push({
      san: record.san,
      label: labelFor(record),
      lineId: record.lineId,
      comment: record.comment,
    })
  }
  return branches
}

function startFenOf(lines: LineInput[]): string {
  for (const line of lines) {
    const path = firstPath(line.pgn)
    if (path) return path.startFen
  }
  return START_FEN
}

function commentOnLast(lines: LineInput[], path: string[]): string | undefined {
  if (path.length === 0) return undefined
  for (const line of lines) {
    for (const candidate of allPaths(line.pgn)) {
      const matches = path.every((san, index) => candidate.moves[index]?.san === san)
      if (!matches) continue
      const comment = candidate.moves[path.length - 1]?.comment
      if (comment) return comment
    }
  }
  return undefined
}

export function studyView(lines: LineInput[], myColor: Color, path: string[], followLineId?: string): StudyView {
  const compiled = compile(lines, myColor)
  let fen = startFenOf(lines)
  const played: { san: string; fenBefore: string }[] = []
  for (const san of path) {
    const applied = applySan(fen, san)
    if (!applied) {
      return {
        fen,
        valid: false,
        youToMove: false,
        prompt: 'This position is not in the lines you are learning.',
        branches: [],
        finished: true,
      }
    }
    played.push({ san, fenBefore: fen })
    fen = applied.fen
  }

  const node = compiled.nodes.get(positionKey(fen))
  const youToMove = sideToMove(fen) === myColor
  const records = youToMove ? (node?.myMoves ?? []) : (node?.opponentMoves ?? [])
  const choices = uniqueBySan(records)
  const followed = followLineId ? records.find((record) => record.lineId === followLineId) : undefined
  const onlyChoice = choices.length === 1 ? records.find((record) => record.san === choices[0].san) : undefined
  const continuation = followed ?? onlyChoice
  const branches = choices.length > 1 ? choices : []
  const last = played[played.length - 1]
  const lastSquares = last ? moveSquares(last.fenBefore, last.san) : null
  const actor = !last
    ? ''
    : sideToMove(last.fenBefore) === myColor
      ? 'You'
      : sideToMove(last.fenBefore) === 'white'
        ? 'White'
        : 'Black'
  const opponentName = otherColor(myColor) === 'white' ? 'White' : 'Black'

  let prompt = 'The starting position.'
  if (!last && !youToMove) prompt = `${opponentName} to move.`
  else if (!last && youToMove) prompt = 'Your first move is ready.'
  else if (last) prompt = `${actor} played ${last.san}.`

  return {
    fen,
    valid: true,
    youToMove,
    prompt,
    comment: commentOnLast(lines, path),
    branches,
    continueSan: continuation?.san,
    continueLabel: continuation ? labelFor(continuation) : undefined,
    continueLineId: continuation?.lineId,
    finished: !continuation && branches.length === 0,
    lastMove: lastSquares ? [lastSquares.from, lastSquares.to] : undefined,
  }
}
