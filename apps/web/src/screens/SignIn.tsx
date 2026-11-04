import { useState } from 'react'
import { DataError, useData } from '../lib/data'

type Mode = 'in' | 'up'

export function SignIn() {
  const data = useData()
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const canSubmit = Boolean(email.trim() && password)

  async function submit(next: Mode) {
    if (pending) return
    setError('')
    setPending(true)
    try {
      if (next === 'in') await data.signIn(email, password)
      else await data.signUp(email, password)
    } catch (caught) {
      setError(
        caught instanceof DataError
          ? caught.message
          : next === 'up'
            ? 'Could not create account.'
            : 'Could not sign in.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        void submit(mode)
      }}
    >
      <h1>{mode === 'in' ? 'Sign in' : 'Create account'}</h1>
      <p className="lede">
        {data.configured
          ? 'Your openings sync across devices when you are online.'
          : 'Your openings are saved on this device.'}
      </p>
      <label>
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'up' ? 6 : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {mode === 'up' ? <p className="lede">Use at least 6 characters.</p> : null}
      {error ? <p className="note">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={pending || !canSubmit}>
        {pending
          ? mode === 'up'
            ? 'Creating account…'
            : 'Signing in…'
          : mode === 'up'
            ? 'Create account'
            : 'Sign in'}
      </button>
      <button
        className="btn secondary"
        type="button"
        disabled={pending}
        onClick={() => {
          setError('')
          setMode(mode === 'in' ? 'up' : 'in')
        }}
      >
        {mode === 'in' ? 'Create account' : 'Sign in instead'}
      </button>
    </form>
  )
}
