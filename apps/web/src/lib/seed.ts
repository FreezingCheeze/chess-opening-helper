import {
  caroKannLines,
  keepOneUserReply,
  pgnForMoves,
  repertoireAdjustments,
  type DraftLine,
} from '@opening/engine'
import {
  allRows,
  deleteRow,
  getMeta,
  putRow,
  setMeta,
  type LineRecord,
  type OpeningRecord,
  type Tombstone,
} from './db'

const SEED_KEY = 'seed:caro-kann:'
const SEED_VERSION = 3
const ID_PREFIX = 'repertoire:caro:'

const runs = new Map<string, Promise<boolean>>()

const seedLearning = new Map(
  keepOneUserReply(
    caroKannLines.map(
      (line): DraftLine => ({
        id: `${ID_PREFIX}${line.slug}`,
        name: line.name,
        groupName: line.groupName,
        pgn: pgnForMoves(line.moves),
        included: true,
        yourChoice: false,
      }),
    ),
    'black',
  ).map((draft) => [draft.id, draft.included]),
)

export function seedCaroKann(userId: string): Promise<boolean> {
  const running = runs.get(userId)
  if (running) return running
  const run = writeCaroKann(userId).finally(() => runs.delete(userId))
  runs.set(userId, run)
  return run
}

async function writeCaroKann(userId: string): Promise<boolean> {
  let changed = false
  const openings = (await allRows<OpeningRecord>('openings')).filter((row) => row.userId === userId)
  let opening = openings.find((row) => row.myColor === 'black' && /caro/i.test(row.name))
  const stamp = new Date().toISOString()
  if (!opening) {
    opening = {
      id: crypto.randomUUID(),
      userId,
      name: 'Caro-Kann',
      myColor: 'black',
      createdAt: stamp,
      updatedAt: stamp,
      dirty: true,
    }
    await putRow('openings', opening)
    changed = true
  }

  const lines = (await allRows<LineRecord>('lines')).filter((row) => row.userId === userId && row.openingId === opening.id)
  let order = lines.reduce((max, line) => Math.max(max, line.sortOrder), 0)
  const seedIds = new Set(caroKannLines.map((line) => `${ID_PREFIX}${line.slug}`))
  const accidentalC5 = pgnForMoves(['e4', 'c6', 'd4', 'd5', 'Nc3', 'c5'])
  for (const line of lines.filter(
    (row) =>
      !seedIds.has(row.id) &&
      row.name === 'c5' &&
      row.groupName === 'Classical' &&
      row.pgn === accidentalC5,
  )) {
    await deleteRow('lines', line.id)
    const stone: Tombstone = { id: `lines:${line.id}`, table: 'lines', rowId: line.id, userId }
    await putRow('tombstones', stone)
    changed = true
  }
  for (const line of caroKannLines) {
    const id = `${ID_PREFIX}${line.slug}`
    const pgn = pgnForMoves(line.moves)
    const included = seedLearning.get(id) ?? true
    const existing = lines.find((row) => row.id === id)
    if (!existing) {
      order += 1
      const created: LineRecord = {
        id,
        userId,
        openingId: opening.id,
        groupName: line.groupName,
        name: line.name,
        pgn,
        included,
        sortOrder: order,
        createdAt: stamp,
        updatedAt: stamp,
        dirty: true,
      }
      await putRow('lines', created)
      changed = true
      continue
    }
    if (existing.pgn === pgn && existing.name === line.name && existing.groupName === line.groupName) {
      continue
    }
    await putRow('lines', {
      ...existing,
      pgn,
      name: line.name,
      groupName: line.groupName,
      updatedAt: stamp,
      dirty: true,
    })
    changed = true
  }

  const version = await getMeta<number>(`${SEED_KEY}${userId}`)
  if (version !== SEED_VERSION) {
    const fresh = (await allRows<LineRecord>('lines')).filter((row) => row.userId === userId && row.openingId === opening.id)
    for (const row of fresh.filter((line) => line.id.startsWith(ID_PREFIX) && !seedIds.has(line.id))) {
      await deleteRow('lines', row.id)
      const stone: Tombstone = { id: `lines:${row.id}`, table: 'lines', rowId: row.id, userId }
      await putRow('tombstones', stone)
      changed = true
    }
    const older = fresh.filter((row) => !row.id.startsWith(ID_PREFIX))
    const adjustment = repertoireAdjustments(older, caroKannLines)
    for (const id of adjustment.deleteIds) {
      await deleteRow('lines', id)
      const stone: Tombstone = { id: `lines:${id}`, table: 'lines', rowId: id, userId }
      await putRow('tombstones', stone)
      changed = true
    }
    const laterIds = new Set(adjustment.laterIds)
    for (const [id, included] of seedLearning) {
      if (!included) laterIds.add(id)
    }
    for (const id of laterIds) {
      const row = fresh.find((line) => line.id === id)
      if (!row?.included) continue
      await putRow('lines', { ...row, included: false, updatedAt: stamp, dirty: true })
      changed = true
    }
    await setMeta(`${SEED_KEY}${userId}`, SEED_VERSION)
  }
  return changed
}
