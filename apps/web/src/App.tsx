import { useEffect, useState } from 'react'
import { useData } from './lib/data'
import { parseHash, type Route } from './lib/routes'
import { AddLine } from './screens/AddLine'
import { CreateOpening } from './screens/CreateOpening'
import { Editor } from './screens/Editor'
import { Library } from './screens/Library'
import { Lichess } from './screens/Lichess'
import { Opening } from './screens/Opening'
import { Paste } from './screens/Paste'
import { Practice } from './screens/Practice'
import { Review } from './screens/Review'
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

function statusText(status: string, configured: boolean, detail?: string): string {
  if (status === 'offline') return 'Offline. Practice still works.'
  if (!configured) return 'Saved on this device'
  if (status === 'syncing') return 'Syncing…'
  if (status === 'error') return detail || 'Could not sync'
  return 'Synced'
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'new-opening':
      return <CreateOpening />
    case 'opening':
      return <Opening id={route.id} />
    case 'add':
      return <AddLine id={route.id} />
    case 'paste':
      return <Paste id={route.id} />
    case 'lichess':
      return <Lichess id={route.id} />
    case 'review':
      return <Review id={route.id} />
    case 'editor':
      return <Editor id={route.id} />
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

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => { window.location.hash = '#/' }}>
          Opening Trainer
        </button>
        {data.user ? <p className="status">{statusText(data.status, data.configured, data.statusDetail)}</p> : null}
      </header>
      <main>
        {!data.ready ? <p>Loading…</p> : data.user ? <Screen route={route} /> : <SignIn />}
      </main>
    </div>
  )
}
