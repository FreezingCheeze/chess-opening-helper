import {
  allPaths,
  applySan,
  findMove,
  learningImpact,
  mainPathFrom,
  moveSquares,
  nearestPath,
  nodeTitleKey,
  pathPrefix,
  planBranchRemoval,
  repertoireOf,
  START_FEN,
  withPreferredMove,
  type BranchPrefs,
  type BranchRemoval,
  type LearningImpact,
  type TreeMove,
} from '@opening/engine'
import { useEffect, useRef, useState } from 'react'
import { Board } from '../components/Board'
import { MoveStrip } from '../components/MoveStrip'
import { BackButton } from '../components/Bits'
import { DataError, useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'
import { AddLines } from './AddLines'

type Dialog =
  | null
  | { kind: 'rename-opening'; name: string; error: string }
  | {
      kind: 'learning'
      included: boolean
      lineIds: string[]
      demoted: LearningImpact['demoted']
      conflicts: LearningImpact['conflicts']
      atStart: boolean
    }
  | { kind: 'remove-opening' }
  | { kind: 'remove-branch'; plan: BranchRemoval }

export function Opening({ id }: { id: string }) {
  const data = useData()
  const dataRef = useRef(data)
  dataRef.current = data
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [prefs, setPrefs] = useState<BranchPrefs>({})
  const [path, setPath] = useState<string[]>([])
  const [trail, setTrail] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [adder, setAdder] = useState<{ anchor: string[] } | null>(null)
  const [actionError, setActionError] = useState('')
  const pathRef = useRef(path)
  const trailRef = useRef(trail)
  const dialogRef = useRef(false)
  const adderRef = useRef(false)
  const focusPath = useRef<string[] | null>(null)
  const openedRef = useRef(false)
  const treeRef = useRef<ReturnType<typeof repertoireOf>>({ fen: START_FEN, moves: [] })

  const tree = opening ? repertoireOf(lines, opening.myColor, prefs) : { fen: START_FEN, moves: [] as TreeMove[] }
  treeRef.current = tree
  pathRef.current = path
  trailRef.current = trail
  dialogRef.current = dialog !== null
  adderRef.current = adder !== null

  useEffect(() => {
    openedRef.current = false
    focusPath.current = null
    pathRef.current = []
    trailRef.current = []
    setExpanded(new Set())
    setPath([])
    setTrail([])
    setPrefs({})
    setDialog(null)
    setAdder(null)
    setMenu(false)
    setActionError('')
    setOpening(undefined)
    setLines([])
  }, [id, data.user?.id])

  useEffect(() => {
    let cancel = false
    void (async () => {
      const api = dataRef.current
      const found = await api.getOpening(id)
      const stored = found ? await api.listLines(id) : []
      const storedPrefs = found ? await api.getBranchPrefs(id) : {}
      if (cancel || !found) {
        if (!cancel) setOpening(found ?? null)
        return
      }
      const nextTree = repertoireOf(stored, found.myColor, storedPrefs)
      const requested = focusPath.current
      focusPath.current = null
      const nextPath = nearestPath(nextTree, requested ?? pathRef.current)
      const oldTrail = trailRef.current
      const validTrail = nearestPath(nextTree, oldTrail)
      let nextTrail = mainPathFrom(nextTree, nextPath)
      if (!requested && oldTrail.length > 0 && validTrail.length === oldTrail.length && pathPrefix(nextPath, validTrail)) {
        nextTrail = oldTrail
      } else if (!requested && validTrail.length > nextPath.length && pathPrefix(nextPath, validTrail)) {
        nextTrail = validTrail
      }
      if (cancel) return
      setOpening(found)
      setLines(stored)
      setPrefs(storedPrefs)
      setPath(nextPath)
      setTrail(nextTrail)
      const firstOpen = !openedRef.current
      setExpanded((current) => {
        const base = firstOpen ? defaultExpanded(nextTree.moves) : current
        return nextPath.length ? withAncestorsExpanded(nextTree.moves, nextPath, base) : base
      })
      if (stored.length > 0) openedRef.current = true
    })()
    return () => {
      cancel = true
    }
  }, [id, data.user?.id, data.revision])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (dialogRef.current || adderRef.current) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveBy(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveBy(1)
      } else if (event.key === 'Escape') setMenu(false)
    }
    function moveBy(direction: -1 | 1) {
      const currentTree = treeRef.current
      const at = pathRef.current
      if (direction < 0) {
        if (at.length === 0) return
        const next = at.slice(0, -1)
        setPath(next)
        setExpanded((current) => withAncestorsExpanded(currentTree.moves, next, current))
        return
      }
      const memory = trailRef.current.length > 0 ? trailRef.current : mainPathFrom(currentTree)
      if (pathPrefix(at, memory) && at.length < memory.length) {
        const next = memory.slice(0, at.length + 1)
        if (nearestPath(currentTree, next).length === next.length) {
          setPath(next)
          setExpanded((current) => withAncestorsExpanded(currentTree.moves, next, current))
          return
        }
      }
      const node = at.length === 0 ? null : findMove(currentTree, at)
      const options = at.length === 0 ? currentTree.moves : (node?.children ?? [])
      if (options.length === 0) return
      const next = [...at, options[0].san]
      setPath(next)
      setTrail(mainPathFrom(currentTree, next))
      setExpanded((current) => withAncestorsExpanded(currentTree.moves, next, current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (opening === undefined) return <p>Loading…</p>
  if (!opening) return <p>That opening is not on this device.</p>

  const active = opening
  const selected = path.length ? findMove(tree, path) : null
  const board = replayPath(tree.fen, path)
  const through = (selected ? selected.lineIds : lines.map((line) => line.id))
    .map((lineId) => lines.find((line) => line.id === lineId))
    .filter((line): line is LineRecord => Boolean(line))
  const learningCount = through.filter((line) => line.included).length
  const only = through.length === 1 ? through[0] : null
  const parentPath = path.slice(0, -1)
  const siblings = path.length === 0 ? tree.moves : parentPath.length === 0 ? tree.moves : (findMove(tree, parentPath)?.children ?? [])
  const canPrefer = Boolean(selected && siblings.length > 1 && !selected.preferred)
  const remembered = trail.length > 0 && pathPrefix(path, trail) ? trail : path
  const canBack = path.length > 0
  const canForward =
    (pathPrefix(path, remembered) && path.length < remembered.length && nearestPath(tree, remembered.slice(0, path.length + 1)).length === path.length + 1) ||
    (path.length === 0 ? tree.moves.length > 0 : (findMove(tree, path)?.children.length ?? 0) > 0)
  const variations = only ? allPaths(only.pgn).length : 0
  const longNote = selected?.note && selected.note.length > 42 ? selected.note : undefined

  function reveal(next: string[]) {
    setExpanded((current) => withAncestorsExpanded(tree.moves, next, current))
  }

  function goTo(next: string[]) {
    setPath(next)
    reveal(next)
    setTrail((current) => (pathPrefix(next, current) && nearestPath(tree, current).length === current.length ? current : mainPathFrom(tree, next)))
  }

  function stepBack() {
    if (path.length === 0) return
    const next = path.slice(0, -1)
    setPath(next)
    reveal(next)
  }

  function stepForward() {
    if (pathPrefix(path, remembered) && path.length < remembered.length) {
      const next = remembered.slice(0, path.length + 1)
      if (nearestPath(tree, next).length === next.length) {
        setPath(next)
        reveal(next)
        return
      }
    }
    const node = path.length === 0 ? null : findMove(tree, path)
    const options = path.length === 0 ? tree.moves : (node?.children ?? [])
    if (options.length === 0) return
    const next = [...path, options[0].san]
    setPath(next)
    setTrail(mainPathFrom(tree, next))
    reveal(next)
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function applyLearning(lineIds: string[], included: boolean, demoted: { id: string }[]) {
    const updates: { id: string; included: boolean }[] = []
    for (const lineId of lineIds) {
      const line = lines.find((item) => item.id === lineId)
      if (line && line.included !== included) updates.push({ id: lineId, included })
    }
    for (const line of demoted) {
      if (!updates.some((item) => item.id === line.id)) updates.push({ id: line.id, included: false })
    }
    if (updates.length === 0) {
      setDialog(null)
      return
    }
    try {
      await data.commitLines(active.id, { update: updates })
      setDialog(null)
      setActionError('')
    } catch (caught) {
      setActionError(caught instanceof DataError ? caught.message : 'Could not save these lines.')
      setDialog(null)
    }
  }

  function requestLearning(included: boolean) {
    if (through.length === 0) return
    setActionError('')
    const lineIds = through.map((line) => line.id)
    if (!included) {
      if (path.length === 0) {
        setDialog({ kind: 'learning', included, lineIds, demoted: [], conflicts: [], atStart: true })
        return
      }
      void applyLearning(lineIds, false, [])
      return
    }
    const pool = lines.map((line) => ({
      id: line.id,
      name: line.name,
      groupName: line.groupName,
      pgn: line.pgn,
      included: lineIds.includes(line.id) ? true : line.included,
    }))
    const impact = learningImpact(pool, lineIds, active.myColor)
    if (impact.conflicts.length > 0 || path.length === 0 || impact.demoted.length > 0) {
      setDialog({
        kind: 'learning',
        included: true,
        lineIds,
        demoted: impact.demoted,
        conflicts: impact.conflicts,
        atStart: path.length === 0,
      })
      return
    }
    void applyLearning(lineIds, true, [])
  }

  async function preferSelected() {
    if (!selected || !canPrefer) return
    const oldFirst = siblings[0]?.san
    const nextPrefs = withPreferredMove(prefs, parentPath, selected.san)
    setPrefs(nextPrefs)
    setTrail((current) => {
      if (!pathPrefix(parentPath, current)) return current
      if (current[parentPath.length] === selected.san) return current
      if (current[parentPath.length] === oldFirst) return mainPathFrom(repertoireOf(lines, active.myColor, nextPrefs), [...parentPath, selected.san])
      return current
    })
    try {
      await data.saveBranchPrefs(active.id, nextPrefs)
      setActionError('')
    } catch {
      setActionError('Could not save that preference.')
    }
  }

  async function saveOpeningName(name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === active.name) {
      setDialog(null)
      return
    }
    const openings = await data.listOpenings()
    const taken = openings.some((item) => item.id !== active.id && item.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (taken) {
      setDialog({ kind: 'rename-opening', name, error: 'You already have an opening with that name.' })
      return
    }
    try {
      await data.updateOpening(active.id, { name: trimmed })
      setDialog(null)
      setActionError('')
    } catch {
      setDialog({ kind: 'rename-opening', name, error: 'Could not rename the opening.' })
    }
  }

  async function commitPositionName(name: string) {
    if (path.length === 0 || !selected) return
    const trimmed = name.trim()
    const current = selected.badge ?? ''
    if (trimmed === current) return
    const titleKey = nodeTitleKey(path)
    const hasTitle = Object.prototype.hasOwnProperty.call(prefs, titleKey)
    try {
      if (only && !hasTitle && selected.badge === only.name) {
        if (!trimmed) return
        await data.updateLine(only.id, { name: trimmed })
      } else {
        const next = { ...prefs }
        if (trimmed) next[titleKey] = trimmed
        else delete next[titleKey]
        setPrefs(next)
        await data.saveBranchPrefs(active.id, next)
      }
      setActionError('')
    } catch {
      setActionError('Could not save that name.')
    }
  }

  async function removeBranch(plan: BranchRemoval) {
    const parent = plan.deleted.length + plan.shortened.length > 0 ? path.slice(0, -1) : path
    focusPath.current = parent
    try {
      await data.commitLines(active.id, {
        deleteIds: plan.deleted.map((line) => line.id),
        update: plan.updates,
        prefs: plan.prefs,
      })
      setPath(parent)
      setTrail(parent)
      setDialog(null)
      setActionError('')
    } catch (caught) {
      focusPath.current = null
      setActionError(caught instanceof DataError ? caught.message : 'Could not remove that line.')
      setDialog(null)
    }
  }

  return (
    <div className="stack">
      {adder ? (
        <AddLines
          opening={active}
          lines={lines}
          anchor={adder.anchor}
          onCancel={() => setAdder(null)}
          onSaved={(next) => {
            focusPath.current = next
            setPath(next)
            setTrail(next)
            setAdder(null)
          }}
        />
      ) : (
        <>
          <div className="opening-head">
            <BackButton to="/" label="All openings" />
            <div className="menu">
              <button
                className="btn secondary menu-button"
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((open) => !open)}
              >
                Opening
              </button>
              {menu ? (
                <div className="menu-pop" role="menu">
                  <button
                    className="btn secondary"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      setAdder({ anchor: [] })
                    }}
                  >
                    Add lines
                  </button>
                  <button
                    className="btn warn"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      setDialog({ kind: 'remove-opening' })
                    }}
                  >
                    Remove opening
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="opening-title">
            <h1>{active.name}</h1>
            <button
              className="btn quiet"
              type="button"
              onClick={() => setDialog({ kind: 'rename-opening', name: active.name, error: '' })}
            >
              Rename
            </button>
          </div>
          <p className="quiet opening-color">{active.myColor === 'white' ? 'You play White.' : 'You play Black.'}</p>
          {data.status === 'offline' ? <p className="quiet">Saved on this device. It will sync when you are back online.</p> : null}
          {data.status === 'syncing' ? <p className="quiet">Syncing with your account…</p> : null}
          {data.status === 'error' ? <p className="note">{data.statusDetail || 'Saved on this device, but sync failed.'}</p> : null}
          {lines.length === 0 ? (
            <div className="stack">
              <div className="board-side stack">
                <Board fen={START_FEN} orientation={active.myColor} interactive={false} />
              </div>
              <p className="callout">This opening has no lines yet. Paste a PGN, or play the moves on the board.</p>
              <button className="btn primary page-action" type="button" onClick={() => setAdder({ anchor: [] })}>
                Add lines
              </button>
            </div>
          ) : (
            <>
              <div className="opening-practice-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={lines.every((line) => !line.included)}
                  onClick={() => go(`/o/${active.id}/practice`)}
                >
                  Practice what I’m learning
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={lines.every((line) => !line.included)}
                  onClick={() => go(`/o/${active.id}/study`)}
                >
                  Study what I’m learning
                </button>
                {lines.every((line) => !line.included) ? (
                  <p className="quiet">Choose Learning on the lines you want here. Later lines stay in the repertoire until you turn them on.</p>
                ) : null}
              </div>
              <div className="stage opening-stage">
                <div className="board-side stack">
                  <Board fen={board.fen} orientation={active.myColor} interactive={false} lastMove={board.lastMove} />
                  <div className="board-nav" role="group" aria-label="Move history">
                    <button type="button" className="btn secondary" aria-label="Previous move" disabled={!canBack} onClick={stepBack}>
                      ←
                    </button>
                    <button type="button" className="btn secondary" aria-label="Next move" disabled={!canForward} onClick={stepForward}>
                      →
                    </button>
                  </div>
                  <div className="board-line">
                    <p className="board-line-title">{positionHeading(path, selected)}</p>
                    <div className="board-line-moves">
                      <MoveStrip startFen={tree.fen} moves={remembered} at={path.length} onPick={(index) => goTo(remembered.slice(0, index + 1))} />
                    </div>
                    <div className="line-actions">
                      <button className="btn secondary" type="button" disabled={!only} onClick={() => only && go(`/o/${active.id}/study/${only.id}`)}>
                        Study this line
                      </button>
                      <button className="btn secondary" type="button" disabled={!only} onClick={() => only && go(`/o/${active.id}/practice/${only.id}`)}>
                        Practice this line
                      </button>
                    </div>
                  </div>
                  {longNote ? <p className="comment">{longNote}</p> : null}
                </div>
                <div className="panel opening-panel stack">
                  <section className="position-card stack" aria-label="Selected position">
                    <h2>{positionHeading(path, selected)}</h2>
                    {selected?.note && !longNote ? <p className="quiet">{selected.note}</p> : null}
                    {path.length > 0 && through.length > 1 ? (
                      <p className="quiet">Several saved lines pass through this move.</p>
                    ) : null}
                    {only && variations > 1 ? (
                      <p className="quiet">
                        This saved line includes {variations} variations. Study and practice both use those variations.
                      </p>
                    ) : null}
                    <NameField
                      key={`${path.join('|')}:${selected?.badge ?? ''}`}
                      initial={selected?.badge ?? ''}
                      disabled={path.length === 0}
                      onCommit={(name) => void commitPositionName(name)}
                    />
                    <button className="btn secondary" type="button" disabled={!canPrefer} onClick={() => void preferSelected()}>
                      Prefer this move
                    </button>
                    <div className="segment" role="group" aria-label="Learning">
                      <button
                        type="button"
                        className="btn secondary"
                        aria-pressed={learningCount === through.length && through.length > 0}
                        onClick={() => requestLearning(true)}
                      >
                        Learning
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        aria-pressed={through.length > 0 && learningCount === 0}
                        onClick={() => requestLearning(false)}
                      >
                        Later
                      </button>
                    </div>
                    <button className="btn secondary" type="button" disabled={path.length === 0} onClick={() => setAdder({ anchor: [...path] })}>
                      Add continuation here
                    </button>
                    <button
                      className="btn warn"
                      type="button"
                      disabled={!selected}
                      onClick={() => {
                        if (!selected) return
                        const plan = planBranchRemoval(lines, path, prefs, selected.moveLabel)
                        if (plan.deleted.length === 0 && plan.shortened.length === 0) return
                        setDialog({ kind: 'remove-branch', plan })
                      }}
                    >
                      Remove from here
                    </button>
                    {actionError ? <p className="note">{actionError}</p> : null}
                  </section>
                  <div className="tree-scroll">
                    <button type="button" className={path.length === 0 ? 'tree-row current' : 'tree-row'} onClick={() => goTo([])}>
                      <span className="tree-twist" aria-hidden="true" />
                      <span className="tree-san">Start</span>
                      {path.length === 0 && lines.length > 1 ? <span className="tree-label">{learningStatus(learningCount, lines.length)}</span> : null}
                    </button>
                    {tree.moves.length > 0 ? (
                      <ul className="tree" role="tree">
                        <TreeRows nodes={tree.moves} depth={0} selected={path} expanded={expanded} onPick={goTo} onToggle={toggleExpanded} />
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
          {dialog ? (
            <DialogView
              dialog={dialog}
              openingName={active.name}
              onClose={() => setDialog(null)}
              onOpeningName={(name) => void saveOpeningName(name)}
              onLearning={() => {
                if (dialog.kind !== 'learning' || dialog.conflicts.length > 0) return
                void applyLearning(dialog.lineIds, dialog.included, dialog.demoted)
              }}
              onRemoveOpening={() => {
                void data.deleteOpening(active.id).then(() => go('/'))
              }}
              onRemoveBranch={() => {
                if (dialog.kind === 'remove-branch') void removeBranch(dialog.plan)
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function positionHeading(path: string[], selected: TreeMove | null): string {
  if (path.length === 0 || !selected) return 'Start'
  return selected.badge ? `${selected.moveLabel} · ${selected.badge}` : selected.moveLabel
}

function NameField({ initial, disabled, onCommit }: { initial: string; disabled: boolean; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled) onCommit(value)
      }}
    >
      <label>
        <span>Name</span>
        <input value={value} disabled={disabled} aria-label="Name" onChange={(event) => setValue(event.target.value)} />
      </label>
    </form>
  )
}

function learningStatus(count: number, total: number): string {
  if (total === 0) return ''
  if (total === 1) return count === 1 ? 'Learning' : 'Later'
  return `${count} of ${total} learning`
}

function DialogView({
  dialog,
  openingName,
  onClose,
  onOpeningName,
  onLearning,
  onRemoveOpening,
  onRemoveBranch,
}: {
  dialog: Exclude<Dialog, null>
  openingName: string
  onClose: () => void
  onOpeningName: (name: string) => void
  onLearning: () => void
  onRemoveOpening: () => void
  onRemoveBranch: () => void
}) {
  const title =
    dialog.kind === 'rename-opening'
      ? 'Rename opening'
      : dialog.kind === 'learning'
        ? dialog.included
          ? 'Set to Learning'
          : 'Set to Later'
        : dialog.kind === 'remove-opening'
          ? 'Remove this opening?'
          : `Remove ${dialog.plan.moveLabel}?`
  return (
    <div className="modal-backdrop">
      <section
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        {dialog.kind === 'rename-opening' ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const value = new FormData(event.currentTarget).get('name')
              const name = typeof value === 'string' ? value : ''
              onOpeningName(name)
            }}
          >
            <label>
              <span>Name</span>
              <input name="name" defaultValue={dialog.name} autoFocus />
            </label>
            {dialog.error ? <p className="note">{dialog.error}</p> : null}
            <div className="confirm-actions">
              <button className="btn secondary" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" type="submit">
                Save
              </button>
            </div>
          </form>
        ) : dialog.kind === 'learning' ? (
          <>
            {dialog.atStart && dialog.conflicts.length === 0 ? (
              <p>
                This sets all {dialog.lineIds.length} lines in “{openingName}” to {dialog.included ? 'Learning' : 'Later'}.
              </p>
            ) : null}
            {dialog.conflicts.length > 0 ? (
              <>
                <p>These lines are different replies for you in the same position. Choose one move in the tree, then set that branch to Learning.</p>
                {dialog.conflicts.map((conflict, index) => (
                  <p key={index}>{conflict.choices.map((choice) => `${choice.san} (${choice.names.join(', ')})`).join(' or ')}</p>
                ))}
              </>
            ) : null}
            {dialog.demoted.length > 0 ? (
              <p>These existing lines will move to Later: {dialog.demoted.map((line) => line.name).join(', ')}.</p>
            ) : null}
            <div className="confirm-actions">
              <button className="btn secondary" type="button" autoFocus onClick={onClose}>
                {dialog.conflicts.length > 0 ? 'Close' : 'Cancel'}
              </button>
              {dialog.conflicts.length === 0 ? (
                <button className="btn primary" type="button" onClick={onLearning}>
                  {dialog.included ? 'Set to Learning' : 'Set to Later'}
                </button>
              ) : null}
            </div>
          </>
        ) : dialog.kind === 'remove-opening' ? (
          <>
            <p>“{openingName}” and all its lines will be deleted.</p>
            <div className="confirm-actions">
              <button className="btn secondary" type="button" autoFocus onClick={onClose}>
                Cancel
              </button>
              <button className="btn warn" type="button" onClick={onRemoveOpening}>
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            {dialog.plan.deleted.length > 0 ? (
              <p>These saved lines will be deleted: {dialog.plan.deleted.map((line) => line.name).join(', ')}.</p>
            ) : (
              <p>No saved line is deleted entirely.</p>
            )}
            {dialog.plan.shortened.map((line) => (
              <p key={line.id}>
                “{line.name}” also contains {line.kept}, which stays. The variation through {dialog.plan.moveLabel} is removed from that line.
              </p>
            ))}
            <div className="confirm-actions">
              <button className="btn secondary" type="button" autoFocus onClick={onClose}>
                Cancel
              </button>
              <button className="btn warn" type="button" onClick={onRemoveBranch}>
                Remove
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function replayPath(startFen: string, path: string[]) {
  let fen = startFen
  let lastMove: [string, string] | undefined
  for (const san of path) {
    const squares = moveSquares(fen, san)
    const applied = applySan(fen, san)
    if (!squares || !applied) return { fen: startFen, lastMove: undefined }
    fen = applied.fen
    lastMove = [squares.from, squares.to]
  }
  return { fen, lastMove }
}

function defaultExpanded(moves: TreeMove[]): Set<string> {
  const open = new Set<string>()
  let nodes = moves
  while (nodes.length === 1 && nodes[0]) {
    open.add(nodes[0].key)
    nodes = nodes[0].children
  }
  return open
}

function withAncestorsExpanded(moves: TreeMove[], path: string[], current: Set<string>): Set<string> {
  const next = new Set(current)
  let nodes = moves
  for (const san of path.slice(0, -1)) {
    const node = nodes.find((item) => item.san === san)
    if (!node) break
    next.add(node.key)
    nodes = node.children
  }
  return next
}

function TreeRows({
  nodes,
  depth,
  selected,
  expanded,
  onPick,
  onToggle,
}: {
  nodes: TreeMove[]
  depth: number
  selected: string[]
  expanded: Set<string>
  onPick: (path: string[]) => void
  onToggle: (key: string) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const current = node.path.length === selected.length && node.path.every((san, index) => san === selected[index])
        const onPath = node.path.every((san, index) => san === selected[index])
        const aside = node.learningCount === 0
        const hasChildren = node.children.length > 0
        const open = hasChildren && expanded.has(node.key)
        const shortNote = node.note && node.note.length <= 42 ? node.note : undefined
        return (
          <li key={node.key} role="none">
            <div
              className={current ? 'tree-row current' : onPath ? 'tree-row on-path' : aside ? 'tree-row later' : 'tree-row'}
              style={{ paddingLeft: 8 + depth * 18 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="tree-twist"
                  aria-label={open ? `Hide moves after ${node.moveLabel}` : `Show moves after ${node.moveLabel}`}
                  aria-expanded={open}
                  onClick={() => onToggle(node.key)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tree-twist" aria-hidden="true" />
              )}
              <button type="button" role="treeitem" aria-selected={current} className="tree-pick" onClick={() => onPick(node.path)}>
                <span className="tree-san">{node.moveLabel}</span>
                <span
                  className={`move-color ${node.color}`}
                  aria-label={`${node.color === 'white' ? 'White' : 'Black'} move`}
                  title={`${node.color === 'white' ? 'White' : 'Black'} move`}
                />
                {node.preferred ? <span className="tree-you">preferred</span> : null}
                {node.badge ? <span className="tree-label">{node.badge}</span> : null}
                {shortNote ? <span className="tree-label">{shortNote}</span> : null}
                {aside ? <span className="tree-label">Later</span> : null}
                {node.learningCount > 0 && node.learningCount < node.lineIds.length ? (
                  <span className="tree-label">{node.learningCount} of {node.lineIds.length} learning</span>
                ) : null}
              </button>
            </div>
            {open ? (
              <ul className="tree" role="group">
                <TreeRows nodes={node.children} depth={depth + 1} selected={selected} expanded={expanded} onPick={onPick} onToggle={onToggle} />
              </ul>
            ) : null}
          </li>
        )
      })}
    </>
  )
}
