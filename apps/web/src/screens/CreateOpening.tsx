import { useState } from 'react'
import type { Color } from '@opening/engine'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import { go } from '../lib/routes'

export function CreateOpening() {
  const data = useData()
  const [name, setName] = useState('')
  const [color, setColor] = useState<Color>('white')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const trimmed = name.trim()
  const canSubmit = Boolean(trimmed) && !pending

  async function create() {
    if (!canSubmit) return
    setError('')
    setPending(true)
    try {
      const openings = await data.listOpenings()
      const taken = openings.some((opening) => opening.name.trim().toLowerCase() === trimmed.toLowerCase())
      if (taken) {
        setError('You already have an opening with that name.')
        return
      }
      const opening = await data.createOpening(trimmed, color)
      go(`/o/${opening.id}`)
    } catch {
      setError('Could not create the opening.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <BackButton to="/" label="All openings" />
      <h1>New opening</h1>
      <label>
        <span>Name</span>
        <input
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError('')
          }}
          placeholder="Caro-Kann"
        />
      </label>
      <div className="segment" role="group" aria-label="Your color">
        <button type="button" className="btn secondary" aria-pressed={color === 'white'} onClick={() => setColor('white')}>
          I play White
        </button>
        <button type="button" className="btn secondary" aria-pressed={color === 'black'} onClick={() => setColor('black')}>
          I play Black
        </button>
      </div>
      <p className="quiet">Board and practice use this side.</p>
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={!canSubmit}>
        {pending ? 'Creating…' : 'Create opening'}
      </button>
    </form>
  )
}
