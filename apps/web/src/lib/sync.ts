import { supabase } from './supabase'
import {
  allRows,
  deleteRow,
  putRow,
  type LineRecord,
  type OpeningRecord,
  type ProgressRecord,
  type Tombstone,
} from './db'

type RemoteOpening = {
  id: string
  user_id: string
  name: string
  my_color: 'white' | 'black'
  created_at: string
  updated_at: string
}

type RemoteLine = {
  id: string
  user_id: string
  opening_id: string
  group_name: string
  name: string
  pgn: string
  included: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

type RemoteProgress = {
  id: string
  user_id: string
  opening_id: string
  position_key: string
  expected_san: string
  introduced: boolean
  needs_review: boolean
  updated_at: string
}

function openingToRemote(row: OpeningRecord): RemoteOpening {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    my_color: row.myColor,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function openingFromRemote(row: RemoteOpening): OpeningRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    myColor: row.my_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: false,
  }
}

function lineToRemote(row: LineRecord): RemoteLine {
  return {
    id: row.id,
    user_id: row.userId,
    opening_id: row.openingId,
    group_name: row.groupName,
    name: row.name,
    pgn: row.pgn,
    included: row.included,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function lineFromRemote(row: RemoteLine): LineRecord {
  return {
    id: row.id,
    userId: row.user_id,
    openingId: row.opening_id,
    groupName: row.group_name,
    name: row.name,
    pgn: row.pgn,
    included: row.included,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: false,
  }
}

function progressToRemote(row: ProgressRecord): RemoteProgress {
  return {
    id: row.id,
    user_id: row.userId,
    opening_id: row.openingId,
    position_key: row.positionKey,
    expected_san: row.expectedSan,
    introduced: row.introduced,
    needs_review: row.needsReview,
    updated_at: row.updatedAt,
  }
}

function progressFromRemote(row: RemoteProgress): ProgressRecord {
  return {
    id: row.id,
    userId: row.user_id,
    openingId: row.opening_id,
    positionKey: row.position_key,
    expectedSan: row.expected_san,
    introduced: row.introduced,
    needsReview: row.needs_review,
    updatedAt: row.updated_at,
    dirty: false,
  }
}

async function mergeRemote<T extends { id: string; updatedAt: string; dirty?: boolean; userId: string }>(
  store: string,
  remote: T[],
  userId: string,
): Promise<void> {
  const local = (await allRows<T>(store)).filter((row) => row.userId === userId)
  const remoteIds = new Set(remote.map((row) => row.id))
  for (const row of remote) {
    const existing = local.find((item) => item.id === row.id)
    if (!existing || (!existing.dirty && existing.updatedAt <= row.updatedAt)) await putRow(store, row)
  }
  for (const row of local) {
    if (!row.dirty && !remoteIds.has(row.id)) await deleteRow(store, row.id)
  }
}

export async function syncAccount(userId: string): Promise<void> {
  if (!supabase) return
  const client = supabase

  const stones = (await allRows<Tombstone>('tombstones')).filter((stone) => stone.userId === userId)
  for (const stone of stones) {
    const { error } = await client.from(stone.table).delete().eq('id', stone.rowId)
    if (error) throw error
    await deleteRow('tombstones', stone.id)
  }

  const openings = (await allRows<OpeningRecord>('openings')).filter((row) => row.userId === userId && row.dirty)
  for (const row of openings) {
    const { error } = await client.from('openings').upsert(openingToRemote(row))
    if (error) throw error
    await putRow('openings', { ...row, dirty: false })
  }

  const lines = (await allRows<LineRecord>('lines')).filter((row) => row.userId === userId && row.dirty)
  for (const row of lines) {
    const { error } = await client.from('lines').upsert(lineToRemote(row))
    if (error) throw error
    await putRow('lines', { ...row, dirty: false })
  }

  const progress = (await allRows<ProgressRecord>('progress')).filter((row) => row.userId === userId && row.dirty)
  for (const row of progress) {
    const { error } = await client.from('progress').upsert(progressToRemote(row))
    if (error) throw error
    await putRow('progress', { ...row, dirty: false })
  }

  const remoteOpenings = await client.from('openings').select('*').eq('user_id', userId)
  if (remoteOpenings.error) throw remoteOpenings.error
  await mergeRemote('openings', ((remoteOpenings.data ?? []) as RemoteOpening[]).map(openingFromRemote), userId)

  const remoteLines = await client.from('lines').select('*').eq('user_id', userId)
  if (remoteLines.error) throw remoteLines.error
  await mergeRemote('lines', ((remoteLines.data ?? []) as RemoteLine[]).map(lineFromRemote), userId)

  const remoteProgress = await client.from('progress').select('*').eq('user_id', userId)
  if (remoteProgress.error) throw remoteProgress.error
  await mergeRemote('progress', ((remoteProgress.data ?? []) as RemoteProgress[]).map(progressFromRemote), userId)
}

export function explainSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Could not sync.'
  if (/relation|schema cache|permission|row-level|42P01/i.test(message)) {
    return 'Run supabase/migrations/0001_init.sql in the Supabase SQL editor, then try again.'
  }
  return message
}
