import { chooseLearning, type BranchPrefs, type SessionEvent } from '@opening/engine'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  allRows,
  applyLocalChanges,
  clearMeta,
  deleteRow,
  getMeta,
  getRow,
  putRow,
  setMeta,
  type BranchPrefsRecord,
  type LineRecord,
  type LocalUser,
  type LocalWrite,
  type OpeningRecord,
  type ProgressRecord,
  type Tombstone,
} from './db'
import { supabase, supabaseConfigured } from './supabase'
import { seedCaroKann } from './seed'
import { explainSyncError, syncAccount } from './sync'

export type Account = { id: string; email: string }

export type OpeningSummary = OpeningRecord & { lineCount: number }

type Status = 'device' | 'synced' | 'syncing' | 'offline' | 'error'

type DataApi = {
  ready: boolean
  user: Account | null
  configured: boolean
  online: boolean
  status: Status
  statusDetail?: string
  lastSyncedAt?: string
  revision: number
  syncNow: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  listOpenings: () => Promise<OpeningRecord[]>
  listOpeningSummaries: () => Promise<OpeningSummary[]>
  getOpening: (id: string) => Promise<OpeningRecord | undefined>
  createOpening: (name: string, myColor: 'white' | 'black') => Promise<OpeningRecord>
  updateOpening: (id: string, patch: { name?: string }) => Promise<void>
  deleteOpening: (id: string) => Promise<void>
  listLines: (openingId: string) => Promise<LineRecord[]>
  updateLine: (
    id: string,
    patch: Partial<Pick<LineRecord, 'name' | 'groupName' | 'included' | 'pgn' | 'sortOrder'>>,
  ) => Promise<void>
  setLineLearning: (openingId: string, lineId: string, included: boolean, myColor: 'white' | 'black') => Promise<void>
  getBranchPrefs: (openingId: string) => Promise<BranchPrefs>
  saveBranchPrefs: (openingId: string, prefs: BranchPrefs) => Promise<void>
  deleteLine: (id: string) => Promise<void>
  commitLines: (
    openingId: string,
    changes: {
      create?: { name: string; groupName: string; pgn: string; included: boolean }[]
      update?: { id: string; name?: string; groupName?: string; pgn?: string; included?: boolean }[]
      deleteIds?: string[]
      prefs?: BranchPrefs
    },
  ) => Promise<void>
  listProgress: (openingId: string) => Promise<ProgressRecord[]>
  applyEvents: (openingId: string, events: SessionEvent[]) => Promise<void>
}

const DataContext = createContext<DataApi | null>(null)

export class DataError extends Error {}

const now = () => new Date().toISOString()

async function digest(salt: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('')
}

function salt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((part) => part.toString(16).padStart(2, '0')).join('')
}

function cleanEmail(email: string): string {
  return email.trim().toLowerCase()
}

function friendlyAuth(error: { message?: string }): string {
  const message = error.message ?? 'Could not sign in.'
  if (/invalid login|invalid credentials/i.test(message)) return 'That email or password does not match.'
  if (/already registered|already exists/i.test(message)) return 'An account with that email already exists. Sign in instead.'
  if (/not confirmed/i.test(message)) {
    return 'Please confirm your email before signing in.'
  }
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'Use a password of at least 6 characters.'
  return message
}

async function tombstone(table: Tombstone['table'], rowId: string, userId: string): Promise<void> {
  await deleteRow(table, rowId)
  const stone: Tombstone = { id: `${table}:${rowId}`, table, rowId, userId }
  await putRow('tombstones', stone)
}

async function adoptLocalRows(email: string, remoteId: string): Promise<void> {
  const users = await allRows<LocalUser>('users')
  const local = users.find((user) => user.email === email && user.id !== remoteId)
  if (!local) return
  for (const store of ['openings', 'lines', 'progress'] as const) {
    const rows = await allRows<{ id: string; userId: string }>(store)
    for (const row of rows) {
      if (row.userId === local.id) await putRow(store, { ...row, userId: remoteId, dirty: true, updatedAt: now() })
    }
  }
  const prefsRows = (await allRows<BranchPrefsRecord>('branchPrefs')).filter((row) => row.userId === local.id)
  for (const row of prefsRows) {
    const migrated: BranchPrefsRecord = {
      ...row,
      id: `${remoteId}:${row.openingId}`,
      userId: remoteId,
      updatedAt: now(),
      dirty: true,
    }
    await putRow('branchPrefs', migrated)
    if (row.id !== migrated.id) await deleteRow('branchPrefs', row.id)
  }
  const stones = await allRows<Tombstone>('tombstones')
  for (const stone of stones) {
    if (stone.userId === local.id) await putRow('tombstones', { ...stone, userId: remoteId })
  }
  await deleteRow('users', local.id)
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<Account | null>(null)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [status, setStatus] = useState<Status>(supabaseConfigured ? 'synced' : 'device')
  const [statusDetail, setStatusDetail] = useState<string>()
  const [lastSyncedAt, setLastSyncedAt] = useState<string>()
  const [revision, setRevision] = useState(0)
  const userRef = useRef<Account | null>(null)
  const syncing = useRef(false)
  const queued = useRef(false)
  userRef.current = user

  const bump = () => setRevision((value) => value + 1)
  const activating = useRef(new Map<string, Promise<void>>())

  const syncNow = async () => {
    const current = userRef.current
    if (!supabase || !current) return
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }
    if (syncing.current) {
      queued.current = true
      return
    }
    syncing.current = true
    setStatus('syncing')
    try {
      await syncAccount(current.id)
      setLastSyncedAt(now())
      setStatus('synced')
      setStatusDetail(undefined)
      bump()
    } catch (error) {
      setStatus('error')
      setStatusDetail(explainSyncError(error))
    } finally {
      syncing.current = false
      if (queued.current) {
        queued.current = false
        void syncNow()
      }
    }
  }

  const activate = (account: Account) => {
    const previous = activating.current.get(account.id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      setUser(account)
      userRef.current = account
      if (supabase) await syncNow()
      const seeded = await seedCaroKann(account.id).catch(() => false)
      if (seeded && supabase) await syncNow()
      else if (seeded) bump()
    })
    activating.current.set(account.id, run)
    return run
  }

  useEffect(() => {
    let ignore = false
    const restore = async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (!ignore && session?.user) {
          await activate({ id: session.user.id, email: session.user.email ?? '' })
        }
      } else {
        const saved = await getMeta<Account & { mode: 'local' }>('session')
        if (!ignore && saved?.mode === 'local') await activate({ id: saved.id, email: saved.email })
      }
      if (!ignore) setReady(true)
    }
    void restore()
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      void activate({ id: session.user.id, email: session.user.email ?? '' })
    })
    const onOnline = () => {
      setOnline(true)
      void syncNow()
    }
    const onOffline = () => {
      setOnline(false)
      setStatus('offline')
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      ignore = true
      subscription?.data.subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const api = useMemo<DataApi>(() => {
    const requireUser = () => {
      const current = userRef.current
      if (!current) throw new DataError('Sign in first.')
      return current
    }

    return {
      ready,
      user,
      configured: supabaseConfigured,
      online,
      status: !online ? 'offline' : status,
      statusDetail,
      lastSyncedAt,
      revision,
      syncNow: () => syncNow(),
      async signIn(email, password) {
        const address = cleanEmail(email)
        if (!address || !password) throw new DataError('Enter an email and a password.')
        if (supabase) {
          const { data, error } = await supabase.auth.signInWithPassword({ email: address, password })
          if (error || !data.user) throw new DataError(friendlyAuth(error ?? { message: 'Could not sign in.' }))
          const account = { id: data.user.id, email: data.user.email ?? address }
          await adoptLocalRows(address, account.id)
          await activate(account)
          return
        }
        const users = await allRows<LocalUser>('users')
        const found = users.find((item) => item.email === address)
        if (!found || found.hash !== (await digest(found.salt, password))) {
          throw new DataError('That email or password does not match.')
        }
        const account = { id: found.id, email: found.email }
        await setMeta('session', { ...account, mode: 'local' })
        await activate(account)
        setStatus('device')
      },
      async signUp(email, password) {
        const address = cleanEmail(email)
        if (!address || !password) throw new DataError('Enter an email and a password.')
        if (password.length < 6) throw new DataError('Use a password of at least 6 characters.')
        if (supabase) {
          const { data, error } = await supabase.auth.signUp({ email: address, password })
          if (error) throw new DataError(friendlyAuth(error))
          if (!data.session || !data.user) {
            throw new DataError('Check your email for a confirmation link, then sign in.')
          }
          const account = { id: data.user.id, email: data.user.email ?? address }
          await adoptLocalRows(address, account.id)
          await activate(account)
          return
        }
        const users = await allRows<LocalUser>('users')
        if (users.some((item) => item.email === address)) {
          throw new DataError('An account with that email already exists on this device. Sign in instead.')
        }
        const accountUser: LocalUser = {
          id: crypto.randomUUID(),
          email: address,
          salt: salt(),
          hash: '',
          origin: 'local',
        }
        accountUser.hash = await digest(accountUser.salt, password)
        await putRow('users', accountUser)
        const account = { id: accountUser.id, email: address }
        await setMeta('session', { ...account, mode: 'local' })
        await activate(account)
        setStatus('device')
      },
      async signOut() {
        if (supabase && navigator.onLine) await syncNow().catch(() => undefined)
        await supabase?.auth.signOut()
        await clearMeta('session')
        setUser(null)
        userRef.current = null
      },
      async listOpenings() {
        const current = requireUser()
        return (await allRows<OpeningRecord>('openings'))
          .filter((row) => row.userId === current.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      },
      async listOpeningSummaries() {
        const current = requireUser()
        const openings = await this.listOpenings()
        const counts = new Map<string, number>()
        for (const line of await allRows<LineRecord>('lines')) {
          if (line.userId !== current.id) continue
          counts.set(line.openingId, (counts.get(line.openingId) ?? 0) + 1)
        }
        return openings.map((opening) => ({
          ...opening,
          lineCount: counts.get(opening.id) ?? 0,
        }))
      },
      async getOpening(id) {
        const current = requireUser()
        const row = await getRow<OpeningRecord>('openings', id)
        return row?.userId === current.id ? row : undefined
      },
      async createOpening(name, myColor) {
        const current = requireUser()
        const stamp = now()
        const row: OpeningRecord = {
          id: crypto.randomUUID(),
          userId: current.id,
          name: name.trim(),
          myColor,
          createdAt: stamp,
          updatedAt: stamp,
          dirty: true,
        }
        await putRow('openings', row)
        bump()
        void syncNow()
        return row
      },
      async updateOpening(id, patch) {
        const current = requireUser()
        const rows = await allRows<OpeningRecord>('openings')
        const row = rows.find((item) => item.id === id && item.userId === current.id)
        if (!row) return
        await putRow('openings', { ...row, ...patch, updatedAt: now(), dirty: true })
        bump()
        void syncNow()
      },
      async deleteOpening(id) {
        const current = requireUser()
        const lines = (await allRows<LineRecord>('lines')).filter((row) => row.openingId === id && row.userId === current.id)
        const progress = (await allRows<ProgressRecord>('progress')).filter(
          (row) => row.openingId === id && row.userId === current.id,
        )
        const branchPrefs = (await allRows<BranchPrefsRecord>('branchPrefs')).filter(
          (row) => row.openingId === id && row.userId === current.id,
        )
        for (const line of lines) await tombstone('lines', line.id, current.id)
        for (const mark of progress) await tombstone('progress', mark.id, current.id)
        for (const prefs of branchPrefs) await deleteRow('branchPrefs', prefs.id)
        await tombstone('openings', id, current.id)
        bump()
        void syncNow()
      },
      async listLines(openingId) {
        const current = requireUser()
        return (await allRows<LineRecord>('lines'))
          .filter((row) => row.userId === current.id && row.openingId === openingId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
      },
      async updateLine(id, patch) {
        const current = requireUser()
        const rows = await allRows<LineRecord>('lines')
        const row = rows.find((item) => item.id === id && item.userId === current.id)
        if (!row) return
        await putRow('lines', { ...row, ...patch, updatedAt: now(), dirty: true })
        bump()
        void syncNow()
      },
      async setLineLearning(openingId, lineId, included, myColor) {
        const lines = await this.listLines(openingId)
        const drafts = lines.map((line) => ({
          id: line.id,
          name: line.name,
          groupName: line.groupName,
          pgn: line.pgn,
          included: line.included,
          yourChoice: false,
        }))
        const result = chooseLearning(drafts, lineId, included, myColor)
        for (const draft of result.drafts) {
          const original = lines.find((line) => line.id === draft.id)
          if (original && original.included !== draft.included) await this.updateLine(draft.id, { included: draft.included })
        }
      },
      async getBranchPrefs(openingId) {
        const current = requireUser()
        const row = (await allRows<BranchPrefsRecord>('branchPrefs')).find(
          (item) => item.userId === current.id && item.openingId === openingId,
        )
        return row?.prefs ?? {}
      },
      async saveBranchPrefs(openingId, prefs) {
        const current = requireUser()
        await putRow('branchPrefs', {
          id: `${current.id}:${openingId}`,
          userId: current.id,
          openingId,
          prefs,
          updatedAt: now(),
          dirty: true,
        } satisfies BranchPrefsRecord)
        bump()
        void syncNow()
      },
      async deleteLine(id) {
        const current = requireUser()
        const line = (await allRows<LineRecord>('lines')).find((row) => row.id === id && row.userId === current.id)
        if (!line) return
        await tombstone('lines', id, current.id)
        bump()
        void syncNow()
      },
      async commitLines(openingId, changes) {
        const current = requireUser()
        const opening = await getRow<OpeningRecord>('openings', openingId)
        if (!opening || opening.userId !== current.id) throw new DataError('That opening is not on this device.')
        const lines = (await allRows<LineRecord>('lines')).filter(
          (row) => row.userId === current.id && row.openingId === openingId,
        )
        const byId = new Map(lines.map((line) => [line.id, line]))
        const stamp = now()
        let order = lines.reduce((max, line) => Math.max(max, line.sortOrder), 0)
        const writes: LocalWrite[] = []
        const removed = new Set(changes.deleteIds ?? [])
        for (const id of removed) {
          if (!byId.has(id)) throw new DataError('That line is no longer in this opening.')
          writes.push({ store: 'lines', type: 'delete', id })
          writes.push({
            store: 'tombstones',
            type: 'put',
            value: { id: `lines:${id}`, table: 'lines', rowId: id, userId: current.id } satisfies Tombstone,
          })
        }
        const patches = new Map<string, NonNullable<typeof changes.update>[number]>()
        for (const patch of changes.update ?? []) {
          if (removed.has(patch.id)) continue
          patches.set(patch.id, { ...patches.get(patch.id), ...patch, id: patch.id })
        }
        for (const patch of patches.values()) {
          const line = byId.get(patch.id)
          if (!line) throw new DataError('That line is no longer in this opening.')
          const next: LineRecord = {
            ...line,
            ...patch,
            id: line.id,
            userId: line.userId,
            openingId: line.openingId,
            updatedAt: stamp,
            dirty: true,
          }
          writes.push({ store: 'lines', type: 'put', value: next })
        }
        for (const created of changes.create ?? []) {
          order += 1
          const row: LineRecord = {
            id: crypto.randomUUID(),
            userId: current.id,
            openingId,
            groupName: created.groupName,
            name: created.name,
            pgn: created.pgn,
            included: created.included,
            sortOrder: order,
            createdAt: stamp,
            updatedAt: stamp,
            dirty: true,
          }
          writes.push({ store: 'lines', type: 'put', value: row })
        }
        if (changes.prefs) {
          const prefs: BranchPrefsRecord = {
            id: `${current.id}:${openingId}`,
            userId: current.id,
            openingId,
            prefs: changes.prefs,
            updatedAt: stamp,
            dirty: true,
          }
          writes.push({ store: 'branchPrefs', type: 'put', value: prefs })
        }
        writes.push({
          store: 'openings',
          type: 'put',
          value: { ...opening, updatedAt: stamp, dirty: true } satisfies OpeningRecord,
        })
        try {
          await applyLocalChanges(writes)
        } catch {
          throw new DataError('Could not save these lines.')
        }
        bump()
        void syncNow()
      },
      async listProgress(openingId) {
        const current = requireUser()
        return (await allRows<ProgressRecord>('progress')).filter(
          (row) => row.userId === current.id && row.openingId === openingId,
        )
      },
      async applyEvents(openingId, events) {
        const current = requireUser()
        const rows = await this.listProgress(openingId)
        for (const event of events) {
          const existing = rows.find((row) => row.positionKey === event.positionKey && row.expectedSan === event.san)
          const introduced = true
          const needsReview = event.type === 'miss'
          if (existing) {
            const next: ProgressRecord = {
              ...existing,
              introduced: existing.introduced || introduced,
              needsReview: event.type === 'correct' ? false : event.type === 'miss' ? true : existing.needsReview,
              updatedAt: now(),
              dirty: true,
            }
            if (event.type === 'introduced') next.introduced = true
            await putRow('progress', next)
            Object.assign(existing, next)
          } else {
            const created: ProgressRecord = {
              id: crypto.randomUUID(),
              userId: current.id,
              openingId,
              positionKey: event.positionKey,
              expectedSan: event.san,
              introduced,
              needsReview,
              updatedAt: now(),
              dirty: true,
            }
            await putRow('progress', created)
            rows.push(created)
          }
        }
        if (events.length) {
          bump()
          void syncNow()
        }
      },
    }
  }, [lastSyncedAt, online, ready, revision, status, statusDetail, user])

  return <DataContext.Provider value={api}>{children}</DataContext.Provider>
}

export function useData(): DataApi {
  const value = useContext(DataContext)
  if (!value) throw new Error('Data is unavailable.')
  return value
}
