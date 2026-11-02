import { useState } from 'react'
import type { Color } from '@opening/engine'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import { go } from '../lib/routes'

export function CreateOpening() {
  const data = useData()
  const [name, setName] = useState('')
  const [color, setColor] = useState<Color>('black')
  const [error, setError] = useState('')

  async function create() {
    if (!name.trim()) {
      setError('Name the opening.')
      return
    }
    const opening = await data.createOpening(name, color)
    go(`/o/${opening.id}`)
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
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Caro-Kann" />
      </label>
      <div className="segment" role="group" aria-label="Your color">
        <button type="button" className="btn secondary" aria-pressed={color === 'white'} onClick={() => setColor('white')}>
          I play White
        </button>
        <button type="button" className="btn secondary" aria-pressed={color === 'black'} onClick={() => setColor('black')}>
          I play Black
        </button>
      </div>
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="submit">
        Create opening
      </button>
    </form>
  )
}
