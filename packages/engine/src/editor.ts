import { applySan, positionKey, sideToMove, START_FEN } from './chess'
import { toPgn } from './pgn'
import { keepOneUserReply } from './compile'
import type { Color, DraftLine, Step } from './types'

export type EditorMove = {
  san: string
  comment?: string
}

export type EditorState = {
  startFen: string
  myColor: Color
  tree: Record<string, EditorMove[]>
  path: string[]
}

export function newEditor(myColor: Color, startFen = START_FEN): EditorState {
  return { startFen, myColor, tree: {}, path: [] }
}

export function placeOf(state: EditorState): { fen: string; key: string; side: Color } | null {
  let fen = state.startFen
  for (const san of state.path) {
    const applied = applySan(fen, san)
    if (!applied) return null
    fen = applied.fen
  }
  return { fen, key: positionKey(fen), side: sideToMove(fen) }
}

export function editorChoices(state: EditorState): EditorMove[] {
  const place = placeOf(state)
  if (!place) return []
  return state.tree[place.key] ?? []
}

export function playSan(state: EditorState, san: string, comment?: string): EditorState | { error: string } {
  const place = placeOf(state)
  if (!place) return { error: 'This line could not be replayed.' }
  const applied = applySan(place.fen, san)
  if (!applied) return { error: `${san} is not a legal move here.` }
  const existing = state.tree[place.key] ?? []
  const already = existing.find((move) => move.san === applied.san || move.san === san)
  const tree = {
    ...state.tree,
    [place.key]: already ? existing : [...existing, { san: applied.san, comment }],
  }
  return { ...state, tree, path: [...state.path, already?.san ?? applied.san] }
}

export function undoEditor(state: EditorState): EditorState {
  if (state.path.length === 0) return state
  const parentPath = state.path.slice(0, -1)
  const parent = placeOf({ ...state, path: parentPath })
  if (!parent) return { ...state, path: parentPath }
  const san = state.path[state.path.length - 1]
  const applied = applySan(parent.fen, san)
  const childKey = applied ? positionKey(applied.fen) : ''
  const hasChildren = (state.tree[childKey] ?? []).length > 0
  if (hasChildren) return { ...state, path: parentPath }
  const siblings = (state.tree[parent.key] ?? []).filter((move) => move.san !== san)
  const tree = { ...state.tree }
  if (siblings.length) tree[parent.key] = siblings
  else delete tree[parent.key]
  return { ...state, tree, path: parentPath }
}

export function commentOnLast(state: EditorState, comment: string): EditorState {
  if (state.path.length === 0) return state
  const parentPath = state.path.slice(0, -1)
  const parent = placeOf({ ...state, path: parentPath })
  if (!parent) return state
  const san = state.path[state.path.length - 1]
  const cleaned = comment.trim()
  const tree = {
    ...state.tree,
    [parent.key]: (state.tree[parent.key] ?? []).map((move) =>
      move.san === san ? { ...move, comment: cleaned || undefined } : move,
    ),
  }
  return { ...state, tree }
}

export function retreatEditor(state: EditorState): EditorState {
  if (state.path.length === 0) return state
  return { ...state, path: state.path.slice(0, -1) }
}

export function followChoice(state: EditorState, san: string): EditorState {
  const choices = editorChoices(state)
  const match = choices.find((move) => move.san === san)
  if (!match) return state
  return { ...state, path: [...state.path, match.san] }
}

export function rewindForOpponentTry(state: EditorState): EditorState {
  const place = placeOf(state)
  if (!place) return state
  if (place.side !== state.myColor) return state
  if (state.path.length === 0) return state
  return { ...state, path: state.path.slice(0, -1) }
}

function walk(state: EditorState, fen: string, prefix: Step[], into: Step[][]): void {
  const key = positionKey(fen)
  const moves = state.tree[key] ?? []
  if (moves.length === 0) {
    if (prefix.length) into.push(prefix)
    return
  }
  for (const move of moves) {
    const applied = applySan(fen, move.san)
    if (!applied) continue
    walk(state, applied.fen, [...prefix, { san: move.san, comment: move.comment }], into)
  }
}

function divergenceLabel(path: Step[], others: Step[][]): string {
  for (const other of others) {
    const limit = Math.min(path.length, other.length)
    let index = 0
    while (index < limit && path[index].san === other[index].san) index += 1
    if (index < path.length && (index >= other.length || path[index].san !== other[index].san)) {
      return path[index].comment || path.slice(index).find((step) => step.comment)?.comment || path[index].san
    }
  }
  return 'Line'
}

export function editorDrafts(state: EditorState, baseName: string, groupName: string): DraftLine[] {
  const paths: Step[][] = []
  walk(state, state.startFen, [], paths)
  const name = baseName.trim() || 'Line'
  const group = groupName.trim() || 'Lines'
  const drafts: DraftLine[] = paths.map((path, index) => {
    const several = paths.length > 1
    const label = divergenceLabel(path, paths.filter((other) => other !== path))
    return {
      id: `editor-${index + 1}`,
      name: several ? `${name} — ${label}` : name,
      groupName: group,
      pgn: toPgn(state.startFen, path),
      included: true,
      yourChoice: false,
    }
  })
  return keepOneUserReply(drafts, state.myColor)
}

function shortName(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? `${clean.slice(0, 45).trim()}…` : clean
}

/** Draft lines for moves added after a fixed lead-in. Nothing is turned on yet. */
export function editorLines(state: EditorState, anchor: number, baseName: string, groupName: string): DraftLine[] {
  const paths: Step[][] = []
  walk(state, state.startFen, [], paths)
  const extended = paths.filter((path) => path.length > anchor)
  const group = groupName.trim() || 'Lines'
  const fallback = baseName.trim() || 'Line'
  return extended.map((path, index) => {
    const several = extended.length > 1
    const branched = divergenceLabel(path, extended.filter((other) => other !== path))
    const added = path[Math.min(anchor, path.length - 1)]
    const single = added?.comment || added?.san || fallback
    return {
      id: `editor-${index + 1}`,
      name: shortName(several ? branched : single),
      groupName: group,
      pgn: toPgn(state.startFen, path),
      included: false,
      yourChoice: false,
    }
  })
}
