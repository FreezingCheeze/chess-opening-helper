export type Route =
  | { name: 'library' }
  | { name: 'new-opening' }
  | { name: 'opening'; id: string }
  | { name: 'add'; id: string }
  | { name: 'paste'; id: string }
  | { name: 'lichess'; id: string }
  | { name: 'review'; id: string }
  | { name: 'editor'; id: string }
  | { name: 'study'; id: string; lineId?: string }
  | { name: 'practice'; id: string; lineId?: string }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'new') return { name: 'new-opening' }
  if (parts[0] === 'o' && parts[1]) {
    const id = decodeURIComponent(parts[1])
    switch (parts[2]) {
      case 'add':
        return { name: 'add', id }
      case 'paste':
        return { name: 'paste', id }
      case 'lichess':
        return { name: 'lichess', id }
      case 'review':
        return { name: 'review', id }
      case 'board':
        return { name: 'editor', id }
      case 'study':
        return { name: 'study', id, lineId: parts[3] ? decodeURIComponent(parts[3]) : undefined }
      case 'practice':
        return { name: 'practice', id, lineId: parts[3] ? decodeURIComponent(parts[3]) : undefined }
      default:
        return { name: 'opening', id }
    }
  }
  return { name: 'library' }
}

export function go(path: string): void {
  const next = path.startsWith('#') ? path : `#${path}`
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
}
