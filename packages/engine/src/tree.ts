import { applySan, moveSquares, sideToMove, START_FEN } from './chess'
import { allPaths, isGenericGroup, toPgn } from './pgn'
import type { Color, LineInput, Step } from './types'

export type StoredLine = LineInput & { included: boolean }

export type TreeMove = {
  key: string
  san: string
  path: string[]
  fen: string
  moveLabel: string
  you: boolean
  main: boolean
  badge?: string
  note?: string
  lineIds: string[]
  learningCount: number
  lastMove?: [string, string]
  children: TreeMove[]
}

export type Repertoire = {
  fen: string
  moves: TreeMove[]
}

export type LinePatch =
  | { type: 'update'; id: string; pgn?: string; included?: boolean }
  | { type: 'create'; name: string; groupName: string; pgn: string; included: boolean }

type Played = { line: StoredLine; moves: Step[] }

function moveLabel(startFen: string, ply: number, san: string): string {
  const whiteStarts = sideToMove(startFen) === 'white'
  const whiteMove = whiteStarts ? ply % 2 === 0 : ply % 2 === 1
  const number = Math.floor((ply + (whiteStarts ? 0 : 1)) / 2) + 1
  return whiteMove ? `${number}. ${san}` : `${number}... ${san}`
}

function badgeFor(line: StoredLine): string | undefined {
  if (line.name && line.name !== 'Main line' && line.name !== 'Line') return line.name
  if (line.groupName && !isGenericGroup(line.groupName)) return line.groupName
  return undefined
}

function divergenceIndex(moves: string[], others: string[][]): number {
  if (others.length === 0) return Math.max(0, moves.length - 1)
  for (let index = 0; index < moves.length; index += 1) {
    if (others.some((other) => other[index] !== moves[index])) return index
  }
  return Math.max(0, moves.length - 1)
}

export function repertoireOf(lines: StoredLine[], myColor: Color): Repertoire {
  const played: Played[] = []
  for (const line of lines) {
    for (const path of allPaths(line.pgn)) played.push({ line, moves: path.moves })
  }
  const startFen = played[0] ? (allPaths(played[0].line.pgn)[0]?.startFen ?? START_FEN) : START_FEN
  const badges = new Map<string, string>()
  for (const item of played) {
    const sans = item.moves.map((step) => step.san)
    const others = played.filter((other) => other !== item).map((other) => other.moves.map((step) => step.san))
    const badge = badgeFor(item.line)
    if (!badge) continue
    const index = divergenceIndex(sans, others)
    const key = sans.slice(0, index + 1).join('|')
    const existing = badges.get(key)
    if (!existing) badges.set(key, badge)
    else if (existing !== badge) badges.set(key, '')
  }

  function build(prefix: string[], fen: string): TreeMove[] {
    const order: string[] = []
    const comments = new Map<string, string>()
    for (const item of played) {
      if (!prefix.every((san, index) => item.moves[index]?.san === san)) continue
      const step = item.moves[prefix.length]
      if (!step) continue
      if (!order.includes(step.san)) order.push(step.san)
      if (step.comment && !comments.has(step.san)) comments.set(step.san, step.comment)
    }
    return order.map((san, index) => {
      const applied = applySan(fen, san)
      const nextFen = applied?.fen ?? fen
      const path = [...prefix, san]
      const through = played.filter(
        (item) => path.every((move, index) => item.moves[index]?.san === move),
      )
      const lineIds = [...new Set(through.map((item) => item.line.id))]
      const learningCount = lineIds.filter((id) => lines.some((line) => line.id === id && line.included)).length
      const squares = applied ? moveSquares(fen, san) : null
      const badge = badges.get(path.join('|')) || undefined
      const note = comments.get(san)
      return {
        key: path.join('|'),
        san,
        path,
        fen: nextFen,
        moveLabel: moveLabel(startFen, prefix.length, san),
        you: sideToMove(fen) === myColor,
        main: order.length > 1 && index === 0,
        badge: badge && badge !== san ? badge : undefined,
        note: note && note !== badge && note !== san ? note : undefined,
        lineIds,
        learningCount,
        lastMove: squares ? [squares.from, squares.to] : undefined,
        children: applied ? build(path, nextFen) : [],
      }
    })
  }

  return { fen: startFen, moves: build([], startFen) }
}

export function findMove(tree: Repertoire, path: string[]): TreeMove | null {
  let moves = tree.moves
  let found: TreeMove | null = null
  for (const san of path) {
    found = moves.find((move) => move.san === san) ?? null
    if (!found) return null
    moves = found.children
  }
  return found
}

/** Follow the first (main) child from `prefix` to a leaf. */
export function mainPathFrom(tree: Repertoire, prefix: string[] = []): string[] {
  const path = [...prefix]
  let children = prefix.length === 0 ? tree.moves : findMove(tree, prefix)?.children
  if (!children) return path
  while (children.length > 0) {
    path.push(children[0].san)
    children = children[0].children
  }
  return path
}

export function pathPrefix(path: string[], full: string[]): boolean {
  return path.length <= full.length && path.every((san, index) => full[index] === san)
}

export function pathNotation(startFen: string, path: string[]): string {
  const whiteStarts = sideToMove(startFen) === 'white'
  return path
    .map((san, ply) => {
      const whiteMove = whiteStarts ? ply % 2 === 0 : ply % 2 === 1
      const number = Math.floor((ply + (whiteStarts ? 0 : 1)) / 2) + 1
      if (whiteMove) return `${number}. ${san}`
      if (ply === 0) return `${number}... ${san}`
      return san
    })
    .join(' ')
}

function matchingMoves(lines: StoredLine[], path: string[]): Played[] {
  const played: Played[] = []
  for (const line of lines) {
    for (const candidate of allPaths(line.pgn)) {
      if (path.every((san, index) => candidate.moves[index]?.san === san)) {
        played.push({ line, moves: candidate.moves })
      }
    }
  }
  return played
}

export function addRepertoireMove(
  lines: StoredLine[],
  myColor: Color,
  path: string[],
  san: string,
): { path: string[]; patches: LinePatch[] } | { error: string } {
  const trimmed = san.trim().replace(/^\d+\.+\s*/, '')
  if (!trimmed) return { error: 'Type the move first.' }
  const donors = matchingMoves(lines, path)
  const startFen = donors[0] ? (allPaths(donors[0].line.pgn)[0]?.startFen ?? START_FEN) : START_FEN
  if (path.length > 0 && donors.length === 0) return { error: 'That position is not in this opening.' }
  let fen = startFen
  for (const move of path) {
    const applied = applySan(fen, move)
    if (!applied) return { error: 'That position is not in this opening.' }
    fen = applied.fen
  }
  const played = applySan(fen, trimmed)
  if (!played) return { error: `${trimmed} is not a legal move here.` }
  const nextPath = [...path, played.san]
  if (donors.some((item) => item.moves[path.length]?.san === played.san)) {
    return { path: nextPath, patches: [] }
  }

  const donor = donors.find((item) => item.moves.length >= path.length)
  const steps: Step[] = path.map((move, index) => ({ san: move, comment: donor?.moves[index]?.comment }))
  steps.push({ san: played.san })
  const pgn = toPgn(startFen, steps)
  const yours = sideToMove(fen) === myColor
  const ending = donors.filter((item) => item.moves.length === path.length)
  const patches: LinePatch[] = []

  if (yours) {
    for (const item of donors) {
      const next = item.moves[path.length]
      if (!next || next.san === played.san || !item.line.included) continue
      patches.push({ type: 'update', id: item.line.id, included: false })
    }
  }

  if (ending.length > 0) {
    const target = ending.find((item) => item.line.included) ?? ending[0]
    patches.push({
      type: 'update',
      id: target.line.id,
      pgn,
      included: yours ? true : target.line.included,
    })
    return { path: nextPath, patches }
  }

  const groups = [...new Set(donors.map((item) => item.line.groupName).filter(Boolean))]
  patches.push({
    type: 'create',
    name: played.san,
    groupName: groups.length === 1 ? groups[0] : 'Lines',
    pgn,
    included: true,
  })
  return { path: nextPath, patches }
}
