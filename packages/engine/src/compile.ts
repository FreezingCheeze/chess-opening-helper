import { applySan, positionKey, sideToMove } from './chess'
import { allPaths } from './pgn'
import type { Color, Compiled, Conflict, DraftLine, LineInput, MoveRecord, PositionNode } from './types'

function sameMove(record: MoveRecord, san: string, lineId: string): boolean {
  return record.san === san && record.lineId === lineId
}

export function compile(lines: LineInput[], myColor: Color): Compiled {
  const nodes = new Map<string, PositionNode>()
  const ensure = (fen: string): PositionNode => {
    const key = positionKey(fen)
    const existing = nodes.get(key)
    if (existing) return existing
    const created: PositionNode = { key, fen, opponentMoves: [], myMoves: [] }
    nodes.set(key, created)
    return created
  }

  for (const line of lines) {
    for (const path of allPaths(line.pgn)) {
      let fen = path.startFen
      for (const step of path.moves) {
        const node = ensure(fen)
        const side = sideToMove(fen)
        const applied = applySan(fen, step.san)
        if (!applied) break
        const record: MoveRecord = {
          san: step.san,
          lineId: line.id,
          lineName: line.name,
          groupName: line.groupName,
          comment: step.comment,
        }
        const bucket = side === myColor ? node.myMoves : node.opponentMoves
        if (!bucket.some((item) => sameMove(item, step.san, line.id))) bucket.push(record)
        fen = applied.fen
      }
    }
  }

  const conflicts: Conflict[] = []
  for (const node of nodes.values()) {
    const sans = [...new Set(node.myMoves.map((move) => move.san))]
    if (sans.length < 2) continue
    const options = sans.map((san) => {
      const move = node.myMoves.find((item) => item.san === san)!
      return { lineId: move.lineId, lineName: move.lineName, san }
    })
    conflicts.push({ key: node.key, options })
  }

  return { nodes, conflicts }
}

export function chooseLearning(
  drafts: DraftLine[],
  id: string,
  included: boolean,
  myColor: Color,
  existing: (LineInput & { included: boolean })[] = [],
): { drafts: DraftLine[]; demotedExistingIds: string[] } {
  const next = drafts.map((draft) => (draft.id === id ? { ...draft, included } : draft))
  if (!included) return { drafts: next, demotedExistingIds: [] }

  const pool: (LineInput & { included: boolean })[] = [
    ...existing.filter((line) => line.included),
    ...next.filter((draft) => draft.included),
  ]
  const conflicts = compile(pool, myColor).conflicts
  const demote = new Set<string>()
  for (const conflict of conflicts) {
    if (!conflict.options.some((option) => option.lineId === id)) continue
    for (const option of conflict.options) {
      if (option.lineId !== id) demote.add(option.lineId)
    }
  }

  return {
    drafts: next.map((draft) => (demote.has(draft.id) ? { ...draft, included: false } : draft)),
    demotedExistingIds: [...demote].filter((lineId) => existing.some((line) => line.id === lineId)),
  }
}

export function reconcileLearning(
  drafts: DraftLine[],
  preferredId: string | null,
  myColor: Color,
  existing: (LineInput & { included: boolean })[] = [],
): { drafts: DraftLine[]; demotedExistingIds: string[] } {
  const includedIds = drafts.filter((draft) => draft.included).map((draft) => draft.id)
  const order =
    preferredId && includedIds.includes(preferredId)
      ? [...includedIds.filter((id) => id !== preferredId), preferredId]
      : includedIds
  let current = drafts
  const demoted = new Set<string>()
  for (const id of order) {
    const existingNow = existing.map((line) => ({
      ...line,
      included: line.included && !demoted.has(line.id),
    }))
    const result = chooseLearning(current, id, true, myColor, existingNow)
    current = result.drafts
    for (const lineId of result.demotedExistingIds) demoted.add(lineId)
  }
  return { drafts: current, demotedExistingIds: [...demoted] }
}

export function keepOneUserReply(drafts: DraftLine[], myColor: Color): DraftLine[] {
  const enabled = drafts.map((draft) => ({ ...draft, included: true }))
  const demoted = new Set<string>()
  const involved = new Set<string>()
  const conflicts = compile(enabled, myColor).conflicts
  for (const conflict of conflicts) {
    const ordered = conflict.options
      .map((option) => option.lineId)
      .sort(
        (left, right) =>
          enabled.findIndex((draft) => draft.id === left) - enabled.findIndex((draft) => draft.id === right),
      )
    for (const lineId of ordered) involved.add(lineId)
    for (const lineId of ordered.slice(1)) demoted.add(lineId)
  }
  return enabled.map((draft) => ({
    ...draft,
    included: !demoted.has(draft.id),
    yourChoice: draft.yourChoice || involved.has(draft.id),
  }))
}
