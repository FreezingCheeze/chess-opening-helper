import { Chess, type Move } from 'chess.js'
import type { Color } from './types'

export const START_FEN = new Chess().fen()

export function positionKey(fen: string): string {
  const [board, turn, castling, ep] = fen.split(' ')
  return `${board} ${turn} ${castling} ${ep}`
}

export function checkedSide(fen: string): Color | null {
  try {
    const chess = new Chess(fen)
    if (!chess.inCheck()) return null
    return chess.turn() === 'w' ? 'white' : 'black'
  } catch {
    return null
  }
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

export function otherColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white'
}

export function normalizeFen(fen: string): string | null {
  try {
    return new Chess(fen).fen()
  } catch {
    return null
  }
}

export function applySan(
  fen: string,
  san: string,
): { fen: string; from: string; to: string; san: string } | null {
  try {
    const chess = new Chess(fen)
    const move = chess.move(san)
    if (!move) return null
    return { fen: chess.fen(), from: move.from, to: move.to, san: move.san }
  } catch {
    return null
  }
}

export function moveSquares(fen: string, san: string): { from: string; to: string } | null {
  const applied = applySan(fen, san)
  if (!applied) return null
  return { from: applied.from, to: applied.to }
}

export function legalDests(fen: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return map
  }
  for (const move of chess.moves({ verbose: true }) as Move[]) {
    const list = map.get(move.from) ?? []
    if (!list.includes(move.to)) list.push(move.to)
    map.set(move.from, list)
  }
  return map
}

export function interpretMove(
  fen: string,
  from: string,
  to: string,
  promotion?: string,
): { san: string; fen: string; from: string; to: string } | { promotion: true } | null {
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return null
  }
  const options = (chess.moves({ verbose: true }) as Move[]).filter((move) => move.from === from && move.to === to)
  if (options.length === 0) return null
  const chosen = promotion ? options.find((move) => move.promotion === promotion) : options.find((move) => !move.promotion)
  if (!chosen) {
    if (options.some((move) => move.promotion)) return { promotion: true }
    return null
  }
  try {
    const played = chess.move(chosen.san)
    if (!played) return null
    return { san: played.san, fen: chess.fen(), from: played.from, to: played.to }
  } catch {
    return null
  }
}
