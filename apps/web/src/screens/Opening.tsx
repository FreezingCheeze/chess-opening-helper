import {
  addRepertoireMove,
  applySan,
  chooseLearning,
  findMove,
  interpretMove,
  moveSquares,
  pathNotation,
  repertoireOf,
  sideToMove,
  type TreeMove,
} from '@opening/engine'
import { useEffect, useRef, useState } from 'react'
import { Board, PromotionPicker } from '../components/Board'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'

export function Opening({ id }: { id: string }) {
  const data = useData()
  const dataRef = useRef(data)
  dataRef.current = data
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [path, setPath] = useState<string[]>([])
  const [shown, setShown] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [opened, setOpened] = useState(false)
  const [moveText, setMoveText] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    setOpened(false)
    setExpanded(new Set())
    setPath([])
    setShown([])
    setPending(null)
    setMessage('')
    setConfirm(null)
    setOpening(undefined)
    setLines([])
  }, [id, data.user?.id])

  useEffect(() => {
    let cancel = false
    void (async () => {
      const api = dataRef.current
      const found = await api.getOpening(id)
      const stored = found ? await api.listLines(id) : []
      if (!cancel) {
        setOpening(found ?? null)
        setLines(stored)
      }
    })()
    return () => {
      cancel = true
    }
  }, [id, data.user?.id, data.revision])

  const tree = opening ? repertoireOf(lines, opening.myColor) : { fen: '', moves: [] as TreeMove[] }

  useEffect(() => {
    if (!opening || opened || tree.moves.length === 0) return
    setExpanded(defaultExpanded(tree.moves))
    setOpened(true)
  }, [opened, opening, lines])

  if (opening === undefined) return <p>Loading…</p>
  if (!opening) return <p>That opening is not on this device.</p>

  const active = opening
  const selected = path.length ? findMove(tree, path) : null
  const board = replayPath(tree.fen, shown)
  const fen = board.fen
  const turn = sideToMove(fen)
  const yours = turn === active.myColor
  const actor = turn === 'white' ? 'White' : 'Black'
  const throughIds = selected ? selected.lineIds : path.length === 0 ? lines.map((line) => line.id) : []
  const through = throughIds
    .map((lineId) => lines.find((line) => line.id === lineId))
    .filter((line): line is LineRecord => Boolean(line))
  const learningCount = through.filter((line) => line.included).length
  const only = through.length === 1 ? through[0] : null
  const notation = pathNotation(tree.fen, board.ok ? shown : [])
  const showingSelection = path.length === shown.length && path.every((san, index) => san === shown[index])

  function revealPath(next: string[]) {
    setExpanded((current) => withPathExpanded(tree.moves, next, current))
  }

  function pickPath(next: string[]) {
    setPath(next)
    setMessage('')
    if (next.length === 0) return
    revealPath(next)
  }

  function showSelection() {
    setShown(path)
    setPending(null)
    setMessage('')
  }

  function toggleExpanded(key: string, nodePath: string[]) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
        if (path.length > nodePath.length && nodePath.every((san, index) => san === path[index])) {
          setPath(nodePath)
        }
      } else {
        next.add(key)
      }
      return next
    })
  }

  const branchKeys = selected
    ? expandableKeys(selected)
    : path.length === 0
      ? expandableKeysFrom(tree.moves)
      : []

  function expandSelected() {
    if (branchKeys.length === 0) return
    setExpanded((current) => {
      const next = new Set(current)
      for (const key of branchKeys) next.add(key)
      return next
    })
  }

  function collapseSelected() {
    if (branchKeys.length === 0) return
    const keys = new Set(branchKeys)
    setExpanded((current) => {
      const next = new Set(current)
      for (const key of keys) next.delete(key)
      return next
    })
    if (selected && path.length > selected.path.length) setPath(selected.path)
  }

  async function rename(line: LineRecord, name: string) {
    const next = name.trim()
    if (!next || next === line.name) return
    await data.updateLine(line.id, { name: next })
  }

  async function setLearning(included: boolean) {
    let next = lines
    const apply = (lineId: string, value: boolean) => {
      const drafts = next.map((line) => ({
        id: line.id,
        name: line.name,
        groupName: line.groupName,
        pgn: line.pgn,
        included: line.included,
        yourChoice: false,
      }))
      const result = chooseLearning(drafts, lineId, value, active.myColor)
      next = next.map((line) => {
        const draft = result.drafts.find((item) => item.id === line.id)
        return draft ? { ...line, included: draft.included } : line
      })
    }
    const ordered = [...through].sort((left, right) => Number(left.included) - Number(right.included))
    for (const line of included ? ordered : through) {
      if (next.find((item) => item.id === line.id)?.included === included) continue
      apply(line.id, included)
    }
    if (included) {
      for (const line of through) {
        if (!next.find((item) => item.id === line.id)?.included) continue
        apply(line.id, true)
      }
    }
    const changed = next.filter((line) => lines.find((item) => item.id === line.id)?.included !== line.included)
    setLines(next)
    for (const line of changed) {
      await data.setLineLearning(active.id, line.id, line.included, active.myColor)
    }
  }

  async function commit(san: string) {
    const result = addRepertoireMove(lines, active.myColor, board.ok ? shown : [], san)
    if ('error' in result) {
      setMessage(result.error)
      setEpoch((tick) => tick + 1)
      setPending(null)
      return
    }
    for (const patch of result.patches) {
      if (patch.type === 'update') {
        await data.updateLine(patch.id, {
          ...(patch.pgn ? { pgn: patch.pgn } : {}),
          ...(patch.included === undefined ? {} : { included: patch.included }),
        })
      } else {
        await data.saveDrafts(active.id, [
          {
            id: 'new',
            name: patch.name,
            groupName: patch.groupName,
            pgn: patch.pgn,
            included: patch.included,
            yourChoice: false,
          },
        ])
      }
    }
    setPath(result.path)
    setShown(result.path)
    revealPath(result.path)
    setMoveText('')
    setMessage('')
    setPending(null)
  }

  function onMove(from: string, to: string, promotion?: string) {
    const result = interpretMove(fen, from, to, promotion)
    if (!result) return
    if ('promotion' in result) {
      setPending({ from, to })
      return
    }
    void commit(result.san)
  }

  return (
    <div className="stack">
      <BackButton to="/" label="All openings" />
      <label>
        <span>Opening</span>
        <input
          defaultValue={active.name}
          key={active.updatedAt}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name && name !== active.name) void data.updateOpening(active.id, { name })
          }}
        />
      </label>
      <p className="quiet">{active.myColor === 'white' ? 'You play White.' : 'You play Black.'}</p>
      <div className="stage">
        <Board
          fen={fen}
          orientation={active.myColor}
          interactive={!pending}
          epoch={epoch}
          lastMove={board.lastMove}
          onMove={(from, to) => onMove(from, to)}
        />
        <div className="panel stack">
          <p className="prompt">{notation || 'Starting position'}</p>
          <p className="quiet tree-help">
            {lines.length === 0
              ? 'Play the first move on the board to start a line.'
              : yours
                ? 'Your move. Add the one reply you want to practice.'
                : `${actor} to move. Add a try, or pick one in the tree.`}
          </p>
          <p className="quiet tree-status">
            {through.length > 0 ? `${learningCount} of ${through.length} learning` : 'Pick a move in the tree.'}
          </p>
          <p className={message ? 'note tree-message' : 'quiet tree-message'}>{message || '\u00a0'}</p>
          {pending ? <PromotionPicker onPick={(piece) => onMove(pending.from, pending.to, piece)} /> : null}
          <div className="segment" role="group" aria-label="Learning">
            <button
              type="button"
              className="btn secondary"
              disabled={through.length === 0}
              aria-pressed={through.length > 0 && learningCount === through.length}
              onClick={() => void setLearning(true)}
            >
              Learning
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={through.length === 0}
              aria-pressed={through.length > 0 && learningCount === 0}
              onClick={() => void setLearning(false)}
            >
              Later
            </button>
          </div>
          <label>
            <span>Line</span>
            <input
              key={only ? `${only.id}-${only.updatedAt}` : 'line-empty'}
              defaultValue={only?.name ?? ''}
              disabled={!only}
              placeholder="Select one line"
              onBlur={(event) => {
                if (only) void rename(only, event.target.value)
              }}
            />
          </label>
          <form
            className="add-move"
            onSubmit={(event) => {
              event.preventDefault()
              void commit(moveText)
            }}
          >
            <input
              aria-label="Add a move"
              value={moveText}
              placeholder="Nf3"
              onChange={(event) => setMoveText(event.target.value)}
            />
            <button className="btn secondary" type="submit">
              Add
            </button>
          </form>
          <div className="tree-actions" role="group" aria-label="Tree">
            <button
              type="button"
              className="btn secondary"
              disabled={tree.moves.length === 0 || showingSelection}
              onClick={showSelection}
            >
              Show
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={branchKeys.length === 0}
              onClick={expandSelected}
            >
              Expand
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={branchKeys.length === 0}
              onClick={collapseSelected}
            >
              Collapse
            </button>
          </div>
          <div className="tree-scroll">
            <button
              type="button"
              className={path.length === 0 ? 'tree-row current' : 'tree-row'}
              onClick={() => pickPath([])}
            >
              <span className="tree-twist" aria-hidden="true" />
              <span className="tree-san">Start</span>
            </button>
            {tree.moves.length > 0 ? (
              <ul className="tree" role="tree">
                <TreeRows
                  nodes={tree.moves}
                  depth={0}
                  selected={path}
                  expanded={expanded}
                  onPick={pickPath}
                  onToggle={toggleExpanded}
                />
              </ul>
            ) : null}
          </div>
          <button
            className="btn warn"
            type="button"
            disabled={!only}
            onClick={() => {
              if (!only) return
              if (confirm === only.id) {
                void data.deleteLine(only.id)
                setConfirm(null)
                setPath([])
                setShown([])
              } else setConfirm(only.id)
            }}
          >
            {only && confirm === only.id ? 'Confirm remove' : 'Remove line'}
          </button>
        </div>
      </div>
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
        disabled={!only}
        onClick={() => {
          if (!only) return
          go(`/o/${active.id}/practice/${only.id}`)
        }}
      >
        Practice this line
      </button>
      <button className="btn secondary" type="button" onClick={() => go(`/o/${active.id}/add`)}>
        Add a line
      </button>
      <button
        className="btn warn"
        type="button"
        onClick={() => {
          if (confirm === 'opening') {
            void data.deleteOpening(active.id).then(() => go('/'))
          } else setConfirm('opening')
        }}
      >
        {confirm === 'opening' ? 'Confirm remove opening' : 'Remove opening'}
      </button>
    </div>
  )
}

function replayPath(startFen: string, path: string[]) {
  let fen = startFen
  let lastMove: [string, string] | undefined
  for (const san of path) {
    const squares = moveSquares(fen, san)
    const applied = applySan(fen, san)
    if (!applied) return { fen: startFen, lastMove: undefined, ok: false }
    fen = applied.fen
    lastMove = squares ? [squares.from, squares.to] : undefined
  }
  return { fen, lastMove, ok: true }
}

function defaultExpanded(moves: TreeMove[]): Set<string> {
  const open = new Set<string>()
  let nodes = moves
  while (nodes.length === 1) {
    open.add(nodes[0].key)
    nodes = nodes[0].children
  }
  return open
}

function withPathExpanded(moves: TreeMove[], path: string[], current: Set<string>): Set<string> {
  const next = new Set(current)
  let nodes = moves
  for (const san of path) {
    const node = nodes.find((item) => item.san === san)
    if (!node) break
    next.add(node.key)
    nodes = node.children
  }
  return next
}

function expandableKeys(node: TreeMove): string[] {
  const keys: string[] = []
  const walk = (item: TreeMove) => {
    if (item.children.length === 0) return
    keys.push(item.key)
    for (const child of item.children) walk(child)
  }
  walk(node)
  return keys
}

function expandableKeysFrom(moves: TreeMove[]): string[] {
  return moves.flatMap((move) => expandableKeys(move))
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
  onToggle: (key: string, path: string[]) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const current = node.path.length === selected.length && node.path.every((san, index) => san === selected[index])
        const onPath = node.path.every((san, index) => san === selected[index])
        const aside = node.learningCount === 0
        const hasChildren = node.children.length > 0
        const open = hasChildren && expanded.has(node.key)
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
                  onClick={() => onToggle(node.key, node.path)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tree-twist" aria-hidden="true" />
              )}
              <button
                type="button"
                role="treeitem"
                aria-selected={current}
                className="tree-pick"
                onClick={() => onPick(node.path)}
              >
                <span className="tree-san">{node.moveLabel}</span>
                {node.you ? <span className="tree-you">you</span> : null}
                {node.badge ? <span className="tree-label">{node.badge}</span> : null}
                {node.note ? <span className="tree-label">{node.note}</span> : null}
                {aside ? <span className="tree-label">Later</span> : null}
                {node.learningCount > 0 && node.learningCount < node.lineIds.length ? (
                  <span className="tree-label">
                    {node.learningCount}/{node.lineIds.length}
                  </span>
                ) : null}
              </button>
            </div>
            {open ? (
              <ul className="tree" role="group">
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  selected={selected}
                  expanded={expanded}
                  onPick={onPick}
                  onToggle={onToggle}
                />
              </ul>
            ) : null}
          </li>
        )
      })}
    </>
  )
}
