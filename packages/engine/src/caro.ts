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
 * White branches follow the moves that show up most often in master/club databases.
 * Where Black has several popular replies, the quieter one is kept for learning.
 */
export const caroKannLines: CaroLine[] = [
  {
    slug: 'classical-1',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'h5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3', 'e6'],
  },
  {
    slug: 'classical-2',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'Bd3', 'Ngf6'],
  },
  {
    slug: 'classical-3',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'Bc4', 'e6'],
  },
  {
    slug: 'classical-4',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'Be2', 'e6'],
  },
  {
    slug: 'classical-5',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nh3', 'Nd7'],
  },
  {
    slug: 'classical-6',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'h5', 'Bh7'],
  },
  {
    slug: 'classical-7',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'f4', 'e6'],
  },
  {
    slug: 'classical-8',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'h4', 'h6'],
  },
  {
    slug: 'classical-9',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'Bd3', 'Ngf6'],
  },
  {
    slug: 'classical-10',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'Bc4', 'e6'],
  },
  {
    slug: 'classical-11',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'Be2', 'e6'],
  },
  {
    slug: 'classical-12',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Bc4', 'e6'],
  },
  {
    slug: 'classical-13',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nh3', 'Nd7'],
  },
  {
    slug: 'classical-14',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'N1e2', 'Nd7'],
  },
  {
    slug: 'classical-15',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'f4', 'e6'],
  },
  {
    slug: 'classical-16',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Nc5', 'b6'],
  },
  {
    slug: 'classical-17',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Bd3', 'e6'],
  },
  {
    slug: 'classical-18',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Qf3', 'e6'],
  },
  {
    slug: 'classical-19',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nd2', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
  },
  {
    slug: 'classical-20',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nd2', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'h4', 'h6'],
  },
  {
    slug: 'classical-21',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nd2', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'Nf3', 'Nd7', 'Bd3', 'Ngf6'],
  },
  {
    slug: 'classical-22',
    name: 'Classical',
    groupName: 'Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nd2', 'dxe4', 'Nxe4', 'Bf5', 'Bd3', 'e6'],
  },
  {
    slug: 'advance-1',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'Ne7', 'O-O', 'c5'],
  },
  {
    slug: 'advance-2',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'Ne7', 'c3', 'Nd7'],
  },
  {
    slug: 'advance-3',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'Ne7', 'a3', 'Nd7'],
  },
  {
    slug: 'advance-4',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Bd3', 'Bxd3', 'Qxd3', 'c5'],
  },
  {
    slug: 'advance-5',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'c3', 'Nd7'],
  },
  {
    slug: 'advance-6',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be3', 'Nd7'],
  },
  {
    slug: 'advance-7',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'g3', 'Nd7'],
  },
  {
    slug: 'advance-8',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Bd3', 'Bxd3', 'Qxd3', 'Qa5+', 'Nc3', 'e6'],
  },
  {
    slug: 'advance-9',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Bd3', 'Bxd3', 'Qxd3', 'Qa5+', 'Bd2', 'Qa4'],
  },
  {
    slug: 'advance-10',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Bd3', 'Bxd3', 'Qxd3', 'Qa5+', 'c3', 'e6'],
  },
  {
    slug: 'advance-11',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'c4', 'e6', 'Nc3', 'Ne7'],
  },
  {
    slug: 'advance-12',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'c4', 'e6', 'Nf3', 'Nd7'],
  },
  {
    slug: 'advance-13',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Bg5', 'Qb6'],
  },
  {
    slug: 'advance-14',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5', 'Ne2', 'e6'],
  },
  {
    slug: 'advance-15',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nc3', 'e6', 'g4', 'Bg6', 'Nge2', 'c5'],
  },
  {
    slug: 'advance-16',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nc3', 'e6', 'Nf3', 'Nd7'],
  },
  {
    slug: 'advance-17',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nc3', 'e6', 'Be3', 'Nd7'],
  },
  {
    slug: 'advance-18',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nd2', 'e6', 'Nb3', 'Nd7'],
  },
  {
    slug: 'advance-19',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nd2', 'e6', 'c3', 'Nd7'],
  },
  {
    slug: 'advance-20',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'c3', 'e6'],
  },
  {
    slug: 'advance-21',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'c4', 'e6'],
  },
  {
    slug: 'advance-22',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Bd3', 'Bxd3', 'Qxd3', 'e6'],
  },
  {
    slug: 'advance-23',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Be3', 'e6'],
  },
  {
    slug: 'advance-24',
    name: 'Advance',
    groupName: 'Advance',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'g4', 'Bg6'],
  },
  {
    slug: 'exchange-1',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'Bg4', 'cxd5', 'Nxd5', 'Qb3', 'Bxf3', 'gxf3', 'e6'],
  },
  {
    slug: 'exchange-2',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'Bg4', 'cxd5', 'Nxd5', 'Be2', 'e6'],
  },
  {
    slug: 'exchange-3',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'Bg4', 'Be2', 'e6'],
  },
  {
    slug: 'exchange-4',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'Bg4', 'Be3', 'e6'],
  },
  {
    slug: 'exchange-5',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Bg5', 'Be6', 'Nf3', 'g6'],
  },
  {
    slug: 'exchange-6',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'Bg5', 'Be6', 'Bxf6', 'gxf6'],
  },
  {
    slug: 'exchange-7',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'Nc6', 'cxd5', 'Nxd5'],
  },
  {
    slug: 'exchange-8',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nf3', 'Nc6'],
  },
  {
    slug: 'exchange-9',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4'],
  },
  {
    slug: 'exchange-10',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Nf3', 'Bg4'],
  },
  {
    slug: 'exchange-11',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'h3', 'e6'],
  },
  {
    slug: 'exchange-12',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Ne2', 'e5'],
  },
  {
    slug: 'exchange-13',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'Nf3', 'Bg4'],
  },
  {
    slug: 'exchange-14',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'Nf6', 'Bd3', 'Nc6'],
  },
  {
    slug: 'exchange-15',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'Nf6', 'c3', 'Nc6'],
  },
  {
    slug: 'exchange-16',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'Nf6', 'Ne5', 'Nc6'],
  },
  {
    slug: 'exchange-17',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'Nf6', 'c4', 'Nc6'],
  },
  {
    slug: 'exchange-18',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'Nf6', 'Bf4', 'Nc6'],
  },
  {
    slug: 'exchange-19',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c3', 'Nc6', 'Bd3', 'Nf6'],
  },
  {
    slug: 'exchange-20',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c3', 'Nc6', 'Nf3', 'Bg4'],
  },
  {
    slug: 'exchange-21',
    name: 'Exchange',
    groupName: 'Exchange',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bf4', 'Nc6'],
  },
  {
    slug: 'fantasy-1',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Bf4', 'Ne7'],
  },
  {
    slug: 'fantasy-2',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Bd2', 'Ne7'],
  },
  {
    slug: 'fantasy-3',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'a3', 'Bxc3+'],
  },
  {
    slug: 'fantasy-4',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Ne2', 'Ne7'],
  },
  {
    slug: 'fantasy-5',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Qd3', 'Ne7'],
  },
  {
    slug: 'fantasy-6',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'e5', 'c5'],
  },
  {
    slug: 'fantasy-7',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Be3', 'Bb4+'],
  },
  {
    slug: 'fantasy-8',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Bd3', 'dxe4'],
  },
  {
    slug: 'fantasy-9',
    name: 'Fantasy',
    groupName: 'Fantasy',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'e5', 'c5'],
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
