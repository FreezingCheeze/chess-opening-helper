import { useEffect, useState } from 'react'

/** Loads async data; stays undefined until the first successful result. Keeps the last value across refreshes. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)

  useEffect(() => {
    let cancel = false
    void load().then((next) => {
      if (!cancel) setValue(next)
    })
    return () => {
      cancel = true
    }
    // Caller owns the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return value
}
