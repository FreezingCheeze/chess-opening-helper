import { positionKey } from './chess'
import { compile } from './compile'
import { allPaths, toPgn } from './pgn'
import { branchParentKey, pathPrefix, type BranchPrefs, type StoredLine } from './tree'
import type { Color, DraftLine, LineInput, Step } from './types'

export type AdditionKind = 'create' | 'extend' | 'duplicate' | 'rejected'

export type AdditionItem = {
  kind: AdditionKind
  id: string
  name: string
  groupName: string
  pgn: string
  sans: string[]
  startFen: string
  existingId?: string
  existingName?: string
  included: boolean
  reason?: string
}

export type LearningChoice = { san: string; names: string[] }

export type LearningImpact = {
  conflicts: { choices: LearningChoice[] }[]
  demoted: { id: string; name: string }[]
}

export type BranchRemoval = {
  moveLabel: string
  deleted: { id: string; name: string }[]
  shortened: { id: string; name: string; kept: string }[]
  updates: { id: string; pgn: string }[]
  prefs: BranchPrefs
}

const TITLE_MARK = '@title:'

function samePosition(left: string, right: string): boolean {
  return positionKey(left) === positionKey(right)
}

function signature(startFen: string, sans: string[]): string {
  return `${positionKey(startFen)} ${sans.join(' ')}`
}

function repertoireStart(existing: StoredLine[]): string | null {
  for (const line of existing) {
    const path = allPaths(line.pgn)[0]
    if (path) return path.startFen
  }
  return null
}

function mergedSteps(base: Step[], extra: Step[]): Step[] {
  const steps = base.map((step) => ({ ...step }))
  for (let index = 0; index < extra.length; index += 1) {
    if (index < steps.length) {
      if (!steps[index].comment && extra[index].comment) steps[index] = { ...steps[index], comment: extra[index].comment }
    } else steps.push({ ...extra[index] })
  }
  return steps
}

function combinePgn(paths: { startFen: string; moves: Step[] }[]): string {
  if (paths.length === 0) return ''
  if (paths.length === 1) return toPgn(paths[0].startFen, paths[0].moves)
  return `${paths.map((path) => toPgn(path.startFen, path.moves).trim()).join('\n\n[Event "Line"]\n\n')}\n`
}

function isPrefix(shorter: string[], longer: string[]): boolean {
  return shorter.length < longer.length && shorter.every((san, index) => longer[index] === san)
}

type WorkingLine = {
  id: string
  name: string
  groupName: string
  included: boolean
  paths: { startFen: string; moves: Step[] }[]
}

/**
 * Compare new lines with the repertoire before saving.
 * Exact duplicates share a start position and move sequence.
 * An extension keeps the original start position, including the path up to the new moves.
 */
export function planAdditions(existing: StoredLine[], drafts: DraftLine[]): AdditionItem[] {
  let adopted = repertoireStart(existing)
  const book: WorkingLine[] = existing.map((line) => ({
    id: line.id,
    name: line.name,
    groupName: line.groupName,
    included: line.included,
    paths: allPaths(line.pgn),
  }))
  const taken = new Set<string>()
  for (const line of book) {
    for (const path of line.paths) taken.add(signature(path.startFen, path.moves.map((step) => step.san)))
  }
  const items: AdditionItem[] = []
  drafts.forEach((draft, draftIndex) => {
    const paths = allPaths(draft.pgn)
    if (paths.length === 0) {
      items.push({
        kind: 'rejected',
        id: `${draft.id}-${draftIndex}`,
        name: draft.name,
        groupName: draft.groupName,
        pgn: draft.pgn,
        sans: [],
        startFen: '',
        included: false,
        reason: 'Those moves could not be read as a chess line.',
      })
      return
    }
    paths.forEach((path, pathIndex) => {
      const sans = path.moves.map((step) => step.san)
      const id = paths.length === 1 ? draft.id : `${draft.id}-${pathIndex + 1}`
      const base = {
        id,
        name: draft.name,
        groupName: draft.groupName,
        sans,
        startFen: path.startFen,
      }
      if (!adopted) adopted = path.startFen
      if (!samePosition(path.startFen, adopted!)) {
        items.push({
          ...base,
          kind: 'rejected',
          pgn: draft.pgn,
          included: false,
          reason: 'This line starts from a different position, so it was not added.',
        })
        return
      }
      const sig = signature(path.startFen, sans)
      if (taken.has(sig)) {
        items.push({
          ...base,
          kind: 'duplicate',
          pgn: toPgn(path.startFen, path.moves),
          included: false,
          reason: 'Already in this repertoire.',
        })
        return
      }
      let host: { line: WorkingLine; path: { startFen: string; moves: Step[] } } | null = null
      for (const line of book) {
        for (const candidate of line.paths) {
          const stored = candidate.moves.map((step) => step.san)
          if (!samePosition(candidate.startFen, path.startFen) || !isPrefix(stored, sans)) continue
          if (!host || candidate.moves.length > host.path.moves.length) host = { line, path: candidate }
        }
      }
      taken.add(sig)
      if (host) {
        const replacement = mergedSteps(host.path.moves, path.moves)
        const hostKey = host.path.moves.map((step) => step.san).join(' ')
        host.line.paths = host.line.paths.map((candidate) =>
          candidate.moves.map((step) => step.san).join(' ') === hostKey
            ? { startFen: candidate.startFen, moves: replacement }
            : candidate,
        )
        items.push({
          ...base,
          kind: 'extend',
          name: host.line.name,
          groupName: host.line.groupName,
          pgn: combinePgn(host.line.paths),
          existingId: host.line.id,
          existingName: host.line.name,
          included: host.line.included,
        })
        return
      }
      items.push({
        ...base,
        kind: 'create',
        pgn: toPgn(path.startFen, path.moves),
        included: false,
      })
    })
  })
  return items
}

/**
 * What happens if the chosen lines are Learning.
 * A selection that contains two replies of your own is left unresolved.
 * Every line that plays a different reply is listed, including lines that share that reply.
 */
export function learningImpact(
  lines: (LineInput & { included: boolean })[],
  chosenIds: string[],
  myColor: Color,
): LearningImpact {
  const chosen = new Set(chosenIds)
  if (chosen.size === 0) return { conflicts: [], demoted: [] }
  const active = lines.filter((line) => line.included)
  const compiled = compile(active, myColor)
  const conflicts: LearningImpact['conflicts'] = []
  const demote = new Map<string, string>()
  for (const node of compiled.nodes.values()) {
    const bySan = new Map<string, { id: string; name: string }[]>()
    for (const move of node.myMoves) {
      const list = bySan.get(move.san) ?? []
      if (!list.some((item) => item.id === move.lineId)) list.push({ id: move.lineId, name: move.lineName })
      bySan.set(move.san, list)
    }
    if (bySan.size < 2) continue
    const chosenSans = [...bySan.entries()].filter(([, group]) => group.some((line) => chosen.has(line.id)))
    if (chosenSans.length === 0) continue
    if (chosenSans.length > 1) {
      conflicts.push({
        choices: chosenSans.map(([san, group]) => ({
          san,
          names: [...new Set(group.filter((line) => chosen.has(line.id)).map((line) => line.name))],
        })),
      })
      continue
    }
    const keepSan = chosenSans[0][0]
    for (const [san, group] of bySan) {
      if (san === keepSan) continue
      for (const line of group) {
        if (chosen.has(line.id)) continue
        demote.set(line.id, line.name)
      }
    }
  }
  if (conflicts.length > 0) return { conflicts, demoted: [] }
  return { conflicts: [], demoted: [...demote].map(([id, name]) => ({ id, name })) }
}

function pathOfPref(key: string): string[] | null {
  if (key.startsWith(TITLE_MARK)) {
    try {
      const value = JSON.parse(key.slice(TITLE_MARK.length)) as unknown
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null
    } catch {
      return null
    }
  }
  if (key === branchParentKey([])) return []
  return key.split('|')
}

export function prunePrefs(prefs: BranchPrefs, branchPath: string[]): BranchPrefs {
  if (branchPath.length === 0) return { ...prefs }
  const parent = branchPath.slice(0, -1)
  const san = branchPath[branchPath.length - 1]
  const next: BranchPrefs = {}
  for (const [key, value] of Object.entries(prefs)) {
    const path = pathOfPref(key)
    if (!path) {
      next[key] = value
      continue
    }
    if (pathPrefix(branchPath, path)) continue
    const atParent = path.length === parent.length && path.every((move, index) => move === parent[index])
    if (atParent && value === san && !key.startsWith(TITLE_MARK)) continue
    next[key] = value
  }
  return next
}

function forkSan(sans: string[], branchPath: string[]): string {
  const limit = Math.min(sans.length, branchPath.length)
  let index = 0
  while (index < limit && sans[index] === branchPath[index]) index += 1
  return sans[index] ?? sans[sans.length - 1] ?? 'line'
}

/** Lines removed by deleting a branch, including other variations stored in the same PGN. */
export function planBranchRemoval(lines: StoredLine[], branchPath: string[], prefs: BranchPrefs, moveLabel: string): BranchRemoval {
  const deleted: BranchRemoval['deleted'] = []
  const shortened: BranchRemoval['shortened'] = []
  const updates: BranchRemoval['updates'] = []
  if (branchPath.length === 0) return { moveLabel, deleted, shortened, updates, prefs }
  for (const line of lines) {
    const paths = allPaths(line.pgn)
    if (paths.length === 0) continue
    const kept: { startFen: string; moves: Step[] }[] = []
    let hit = false
    for (const path of paths) {
      const sans = path.moves.map((step) => step.san)
      if (branchPath.every((san, index) => sans[index] === san)) hit = true
      else kept.push(path)
    }
    if (!hit) continue
    if (kept.length === 0) {
      deleted.push({ id: line.id, name: line.name })
      continue
    }
    shortened.push({
      id: line.id,
      name: line.name,
      kept: [...new Set(kept.map((path) => forkSan(path.moves.map((step) => step.san), branchPath)))].join(', '),
    })
    updates.push({ id: line.id, pgn: combinePgn(kept) })
  }
  return { moveLabel, deleted, shortened, updates, prefs: prunePrefs(prefs, branchPath) }
}
