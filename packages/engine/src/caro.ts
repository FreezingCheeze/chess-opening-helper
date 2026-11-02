import { applySan, positionKey, sideToMove, START_FEN } from './chess'
import { allPaths, toPgn } from './pgn'
import type { Step } from './types'

export type CaroLine = {
  slug: string
  name: string
  groupName: string
  moves: string[]
}

/**
 * One Black reply for every White try in the Caro-Kann.
 * White's branches are the moves that show up most often on Chess.com's opening pages
 * (November 2026). Where several Black moves are actually played, the line keeps the
 * one where White wins least often, and the drawisher of those when they are close.
 * Two Fantasy replies, 5...Ne7 after Bd2 and 5...Bxc3+ after a3, come from the
 * 365chess database because those pages were not published on Chess.com.
 * The Short variation's 5.Be2 Ne7 is the same: Chess.com stops at 4...e6, and
 * 365chess shows 5.Be2 as White's main move and 5...Ne7 as Black's safest reply.
 */
export const caroKannLines: CaroLine[] = [
  {
    slug: 'classical-h4',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
  },
  {
    slug: 'classical-nf3',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'h4', 'h6'],
  },
  {
    slug: 'classical-bd3',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'Bd3', 'Ngf6'],
  },
  {
    slug: 'classical-nd2',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nd2', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
  },
  {
    slug: 'advance-short',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'Ne7'],
  },
  {
    slug: 'advance-tal',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Bd3', 'Bxd3', 'Qxd3', 'Qa5+'],
  },
  {
    slug: 'advance-c4',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'c4', 'e6', 'Nc3', 'Ne7'],
  },
  {
    slug: 'advance-nc3',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nc3', 'e6', 'g4', 'Bg6', 'Nge2', 'c5'],
  },
  {
    slug: 'exchange-panov',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'Bg4', 'cxd5', 'Nxd5', 'Qb3', 'Bxf3', 'gxf3', 'e6'],
  },
  {
    slug: 'exchange-bg5',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Bg5', 'Be6'],
  },
  {
    slug: 'exchange-quiet',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6'],
  },
  {
    slug: 'fantasy-bf4',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Bf4', 'Ne7'],
  },
  {
    slug: 'fantasy-bd2',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Bd2', 'Ne7'],
  },
  {
    slug: 'fantasy-a3',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'a3', 'Bxc3+'],
  },
]

export function pgnForMoves(moves: string[]): string {
  const steps: Step[] = []
  let fen = START_FEN
  for (const san of moves) {
    const applied = applySan(fen, san)
    if (!applied) throw new Error(`Illegal repertoire move ${san}`)
    steps.push({ san: applied.san })
    fen = applied.fen
  }
  return toPgn(START_FEN, steps)
}

type AdjustableLine = { id: string; pgn: string; included: boolean }

function pathRelation(seed: string[], path: string[]): 'prefix' | 'exact' | 'other' {
  const length = Math.min(seed.length, path.length)
  for (let index = 0; index < length; index += 1) {
    if (seed[index] !== path[index]) return 'other'
  }
  if (path.length < seed.length) return 'prefix'
  if (path.length === seed.length) return 'exact'
  return 'other'
}

export function repertoireAdjustments(
  existing: AdjustableLine[],
  seeds: { moves: string[] }[],
): { deleteIds: string[]; laterIds: string[] } {
  const replies = new Map<string, string>()
  for (const seed of seeds) {
    let fen = START_FEN
    for (const san of seed.moves) {
      if (sideToMove(fen) === 'black') replies.set(positionKey(fen), san)
      const applied = applySan(fen, san)
      if (!applied) break
      fen = applied.fen
    }
  }

  const deleteIds: string[] = []
  const laterIds: string[] = []
  for (const line of existing) {
    const paths = allPaths(line.pgn)
    if (paths.length === 0) continue
    const covered = paths.every((path) => {
      const sans = path.moves.map((step) => step.san)
      return seeds.some((seed) => pathRelation(seed.moves, sans) !== 'other')
    })
    if (covered) {
      deleteIds.push(line.id)
      continue
    }
    if (!line.included) continue
    const alternate = paths.some((path) => {
      let fen = path.startFen
      for (const step of path.moves) {
        if (sideToMove(fen) === 'black') {
          const reply = replies.get(positionKey(fen))
          if (reply && reply !== step.san) return true
        }
        const applied = applySan(fen, step.san)
        if (!applied) return false
        fen = applied.fen
      }
      return false
    })
    if (alternate) laterIds.push(line.id)
  }
  return { deleteIds, laterIds }
}
