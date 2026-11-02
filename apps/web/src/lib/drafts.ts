import type { DraftLine } from '@opening/engine'

const keyFor = (openingId: string) => `opening-drafts:${openingId}`

export function stashDrafts(openingId: string, drafts: DraftLine[], demotedExistingIds: string[]): void {
  sessionStorage.setItem(keyFor(openingId), JSON.stringify({ drafts, demotedExistingIds }))
}

export function readDrafts(openingId: string): { drafts: DraftLine[]; demotedExistingIds: string[] } | null {
  const raw = sessionStorage.getItem(keyFor(openingId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { drafts?: DraftLine[]; demotedExistingIds?: string[] }
    if (!Array.isArray(parsed.drafts)) return null
    return { drafts: parsed.drafts, demotedExistingIds: parsed.demotedExistingIds ?? [] }
  } catch {
    return null
  }
}

export function clearDrafts(openingId: string): void {
  sessionStorage.removeItem(keyFor(openingId))
}
