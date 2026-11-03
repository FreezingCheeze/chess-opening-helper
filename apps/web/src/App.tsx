import { useEffect, useRef, useState } from 'react'
import { useData } from './lib/data'
import { parseHash, type Route } from './lib/routes'
import { CreateOpening } from './screens/CreateOpening'
import { Library } from './screens/Library'
import { Opening } from './screens/Opening'
import { Practice } from './screens/Practice'
import { SignIn } from './screens/SignIn'
import { Study } from './screens/Study'

function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
  window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return parseHash(hash)
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'new-opening':
      return <CreateOpening />
    case 'opening':
      return <Opening id={route.id} />
    case 'study':
      return <Study id={route.id} lineId={route.lineId} />
    case 'practice':
      return <Practice id={route.id} lineId={route.lineId} />
    default:
      return <Library />
  }
}

export function App() {
  const data = useData()
  const route = useRoute()
  const previousStatus = useRef(data.status)
  const [syncNotice, setSyncNotice] = useState<{ kind: 'success' | 'error'; message: string }>()

  useEffect(() => {
    const wasSyncing = previousStatus.current === 'syncing'
    previousStatus.current = data.status
    if (!wasSyncing || (data.status !== 'synced' && data.status !== 'error')) return

    setSyncNotice(
      data.status === 'synced'
        ? { kind: 'success', message: 'Successfully synced' }
        : { kind: 'error', message: `Error: ${data.statusDetail || 'Could not sync'}` },
    )
    const timeout = window.setTimeout(() => setSyncNotice(undefined), 5000)
    return () => window.clearTimeout(timeout)
  }, [data.status, data.statusDetail])

  const lastSyncedTime = data.lastSyncedAt
    ? new Date(data.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—'

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => { window.location.hash = '#/' }}>
          Opening Trainer
        </button>
        {data.user ? (
          <div className="sync-controls">
            {data.configured ? <p className="last-synced">Last synced at {lastSyncedTime}</p> : null}
            <button
              className="btn secondary sync-button"
              type="button"
              disabled={!data.configured || !data.online || data.status === 'syncing'}
              title={
                !data.configured
                  ? 'Cross-device sync is unavailable'
                  : !data.online
                    ? 'Reconnect to sync'
                    : 'Sync saved data now'
              }
              onClick={() => void data.syncNow()}
            >
              {data.status === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        ) : null}
      </header>
      <main>
        {!data.ready ? <p>Loading…</p> : data.user ? <Screen route={route} /> : <SignIn />}
      </main>
      {syncNotice ? (
        <div className={`sync-toast ${syncNotice.kind}`} role="status" aria-live="polite">
          {syncNotice.message}
        </div>
      ) : null}
    </div>
  )
}
