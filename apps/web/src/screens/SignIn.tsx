import { useState } from 'react'
import { DataError, useData } from '../lib/data'

export function SignIn() {
  const data = useData()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(mode: 'in' | 'up') {
    setError('')
    setPending(true)
    try {
      if (mode === 'in') await data.signIn(email, password)
      else await data.signUp(email, password)
    } catch (caught) {
      setError(caught instanceof DataError ? caught.message : 'Could not sign in.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        void submit('in')
      }}
    >
      <h1>Learn a few lines at a time.</h1>
      <p className="lede">
        Add any opening, keep one reply for yourself, and practice what the other side might play.
      </p>
      <label>
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={pending}>
        Sign in
      </button>
      <button className="btn secondary" type="button" disabled={pending} onClick={() => void submit('up')}>
        Create account
      </button>
    </form>
  )
}
