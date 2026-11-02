import { chooseLearning, type DraftLine, type SessionEvent } from '@opening/engine'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  allRows,
  clearMeta,
  deleteRow,
  getMeta,
  putRow,
  setMeta,
  type LineRecord,
  type LocalUser,
  type OpeningRecord,
  type ProgressRecord,
  type Tombstone,
} from './db'
import { supabase, supabaseConfigured } from './supabase'
import { seedCaroKann } from './seed'
import { explainSyncError, syncAccount } from './sync'

export type Account = { id: string; email: string }

type Status = 'device' | 'synced' | 'syncing' | 'offline' | 'error'

type DataApi = {
  ready: boolean
  user: Account | null
  configured: boolean
  online: boolean
  status: Status
  statusDetail?: string
  revision: number
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  listOpenings: () => Promise<OpeningRecord[]>
  getOpening: (id: string) => Promise<OpeningRecord | undefined>
  createOpening: (name: string, myColor: 'white' | 'black') => Promise<OpeningRecord>
  updateOpening: (id: string, patch: { name?: string }) => Promise<void>
  deleteOpening: (id: string) => Promise<void>
  listLines: (openingId: string) => Promise<LineRecord[]>
  saveDrafts: (openingId: string, drafts: DraftLine[]) => Promise<void>
  updateLine: (
    id: string,
    patch: Partial<Pick<LineRecord, 'name' | 'groupName' | 'included' | 'pgn' | 'sortOrder'>>,
  ) => Promise<void>
  setLineLearning: (openingId: string, lineId: string, included: boolean, myColor: 'white' | 'black') => Promise<void>
  setMainLine: (openingId: string, lineId: string) => Promise<void>
  deleteLine: (id: string) => Promise<void>
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
    return 'Confirm that email, or turn off email confirmation in the free Supabase project.'
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
  const [revision, setRevision] = useState(0)
  const userRef = useRef<Account | null>(null)
  const syncing = useRef(false)
  const queued = useRef(false)
  userRef.current = user

  const bump = () => setRevision((value) => value + 1)

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

  useEffect(() => {
    let ignore = false
    const restore = async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (!ignore && session?.user) {
          const account = { id: session.user.id, email: session.user.email ?? '' }
          await seedCaroKann(account.id).catch(() => false)
          setUser(account)
          userRef.current = account
          await syncAccount(account.id).catch((error: unknown) => {
            setStatus('error')
            setStatusDetail(explainSyncError(error))
          })
        }
      } else {
        const saved = await getMeta<Account & { mode: 'local' }>('session')
        if (!ignore && saved?.mode === 'local') {
          await seedCaroKann(saved.id).catch(() => false)
          setUser({ id: saved.id, email: saved.email })
        }
      }
      if (!ignore) setReady(true)
    }
    void restore()
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      const account = { id: session.user.id, email: session.user.email ?? '' }
      void seedCaroKann(account.id).finally(() => {
        setUser(account)
        userRef.current = account
      })
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
      revision,
      async signIn(email, password) {
        const address = cleanEmail(email)
        if (!address || !password) throw new DataError('Enter an email and a password.')
        if (supabase) {
          const { data, error } = await supabase.auth.signInWithPassword({ email: address, password })
          if (error || !data.user) throw new DataError(friendlyAuth(error ?? { message: 'Could not sign in.' }))
          const account = { id: data.user.id, email: data.user.email ?? address }
          await adoptLocalRows(address, account.id)
          await seedCaroKann(account.id)
          setUser(account)
          userRef.current = account
          await syncNow()
          return
        }
        const users = await allRows<LocalUser>('users')
        const found = users.find((item) => item.email === address)
        if (!found || found.hash !== (await digest(found.salt, password))) {
          throw new DataError('That email or password does not match.')
        }
        const account = { id: found.id, email: found.email }
        await setMeta('session', { ...account, mode: 'local' })
        await seedCaroKann(account.id)
        setUser(account)
        userRef.current = account
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
            throw new DataError('Confirm that email, or turn off email confirmation in the free Supabase project.')
          }
          const account = { id: data.user.id, email: data.user.email ?? address }
          await adoptLocalRows(address, account.id)
          await seedCaroKann(account.id)
          setUser(account)
          userRef.current = account
          await syncNow()
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
        await seedCaroKann(account.id)
        setUser(account)
        userRef.current = account
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
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      },
      async getOpening(id) {
        const rows = await this.listOpenings()
        return rows.find((row) => row.id === id)
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
        for (const line of lines) await tombstone('lines', line.id, current.id)
        for (const mark of progress) await tombstone('progress', mark.id, current.id)
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
      async saveDrafts(openingId, drafts) {
        const current = requireUser()
        const existing = await this.listLines(openingId)
        let order = existing.reduce((max, line) => Math.max(max, line.sortOrder), 0)
        const stamp = now()
        for (const draft of drafts) {
          order += 1
          const row: LineRecord = {
            id: crypto.randomUUID(),
            userId: current.id,
            openingId,
            groupName: draft.groupName.trim() || 'Lines',
            name: draft.name.trim() || 'Line',
            pgn: draft.pgn,
            included: draft.included,
            sortOrder: order,
            createdAt: stamp,
            updatedAt: stamp,
            dirty: true,
          }
          await putRow('lines', row)
        }
        bump()
        void syncNow()
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
      async setMainLine(openingId, lineId) {
        const lines = await this.listLines(openingId)
        const target = lines.find((line) => line.id === lineId)
        if (!target) return
        const lowest = lines.reduce((min, line) => Math.min(min, line.sortOrder), target.sortOrder)
        if (target.sortOrder <= lowest && lines[0]?.id === lineId) return
        await this.updateLine(lineId, { sortOrder: lowest - 1 })
      },
      async deleteLine(id) {
        const current = requireUser()
        const line = (await allRows<LineRecord>('lines')).find((row) => row.id === id && row.userId === current.id)
        if (!line) return
        await tombstone('lines', id, current.id)
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
  }, [online, ready, revision, status, statusDetail, user])

  return <DataContext.Provider value={api}>{children}</DataContext.Provider>
}

export function useData(): DataApi {
  const value = useContext(DataContext)
  if (!value) throw new Error('Data is unavailable.')
  return value
}
