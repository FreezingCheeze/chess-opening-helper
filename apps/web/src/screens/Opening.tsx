import {
  addRepertoireMove,
  applySan,
  findMove,
  interpretMove,
  moveSquares,
  pathNotation,
  repertoireOf,
  sideToMove,
  type TreeMove,
} from '@opening/engine'
import { useEffect, useState } from 'react'
import { Board, PromotionPicker } from '../components/Board'
import { BackButton } from '../components/Bits'
import { useData } from '../lib/data'
import type { LineRecord, OpeningRecord } from '../lib/db'
import { go } from '../lib/routes'

export function Opening({ id }: { id: string }) {
  const data = useData()
  const [opening, setOpening] = useState<OpeningRecord | null | undefined>(undefined)
  const [lines, setLines] = useState<LineRecord[]>([])
  const [path, setPath] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [opened, setOpened] = useState(false)
  const [moveText, setMoveText] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    let cancel = false
    setOpened(false)
    setExpanded(new Set())
    setPath([])
    void (async () => {
      const found = await data.getOpening(id)
      const stored = found ? await data.listLines(id) : []
      if (!cancel) {
        setOpening(found ?? null)
        setLines(stored)
      }
    })()
    return () => {
      cancel = true
    }
  }, [data, id])

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
  const played = replayPath(tree.fen, path)
  const fen = played.fen
  const turn = sideToMove(fen)
  const yours = turn === active.myColor
  const actor = turn === 'white' ? 'White' : 'Black'
  const throughIds = selected ? selected.lineIds : path.length === 0 ? lines.map((line) => line.id) : []
  const through = throughIds
    .map((lineId) => lines.find((line) => line.id === lineId))
    .filter((line): line is LineRecord => Boolean(line))
  const learningCount = through.filter((line) => line.included).length
  const only = through.length === 1 ? through[0] : null
  const notation = pathNotation(tree.fen, played.ok ? path : [])

  function revealPath(next: string[]) {
    setExpanded((current) => withPathExpanded(tree.moves, next, current))
  }

  function pickPath(next: string[]) {
    setPath(next)
    setMessage('')
    setPending(null)
    if (next.length === 0) return
    revealPath(next)
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

  function expandAllUnder(node: TreeMove) {
    setExpanded((current) => {
      const next = new Set(current)
      for (const key of expandableKeys(node)) next.add(key)
      return next
    })
  }

  function collapseAllUnder(node: TreeMove, nodePath: string[]) {
    const keys = new Set(expandableKeys(node))
    setExpanded((current) => {
      const next = new Set(current)
      for (const key of keys) next.delete(key)
      return next
    })
    if (path.length > nodePath.length && nodePath.every((san, index) => san === path[index])) {
      setPath(nodePath)
    }
  }

  function expandWholeTree() {
    setExpanded(new Set(expandableKeysFrom(tree.moves)))
  }

  function collapseWholeTree() {
    setExpanded(new Set())
    setPath([])
  }

  async function rename(line: LineRecord, name: string) {
    const next = name.trim()
    if (!next || next === line.name) return
    await data.updateLine(line.id, { name: next })
  }

  async function setLearning(included: boolean) {
    const ordered = [...through].sort((left, right) => Number(left.included) - Number(right.included))
    for (const line of included ? ordered : through) {
      if (line.included === included) continue
      await data.setLineLearning(active.id, line.id, included, active.myColor)
    }
    if (included) {
      for (const line of through.filter((item) => item.included)) {
        await data.setLineLearning(active.id, line.id, true, active.myColor)
      }
    }
  }

  async function commit(san: string) {
    const result = addRepertoireMove(lines, active.myColor, played.ok ? path : [], san)
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
          lastMove={played.lastMove}
          onMove={(from, to) => onMove(from, to)}
        />
        <div className="panel stack">
          <p className="prompt">{notation || 'Starting position'}</p>
          <p className="quiet">
            {yours
              ? 'Your move. Add the one reply you want to practice.'
              : `${actor} to move. Add a try, or pick one in the tree.`}
          </p>
          {lines.length === 0 ? (
            <p className="quiet">Play the first move on the board to start a line.</p>
          ) : through.length > 0 ? (
            <p className="quiet">
              {learningCount} of {through.length} learning
              {through.length <= 4 ? ` · ${through.map((line) => line.name).join(', ')}` : ''}
            </p>
          ) : null}
          {message ? <p className="note">{message}</p> : null}
          {pending ? <PromotionPicker onPick={(piece) => onMove(pending.from, pending.to, piece)} /> : null}
          {through.length > 0 ? (
            <div className="segment" role="group" aria-label="Learning">
              <button
                type="button"
                className="btn secondary"
                aria-pressed={learningCount === through.length}
                onClick={() => void setLearning(true)}
              >
                Learning
              </button>
              <button
                type="button"
                className="btn secondary"
                aria-pressed={learningCount === 0}
                onClick={() => void setLearning(false)}
              >
                Later
              </button>
            </div>
          ) : null}
          {only ? (
            <label>
              <span>Line</span>
              <input
                key={`${only.id}-${only.updatedAt}`}
                defaultValue={only.name}
                onBlur={(event) => void rename(only, event.target.value)}
              />
            </label>
          ) : null}
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
          <div className="tree-scroll">
            <div className={path.length === 0 ? 'tree-row current' : 'tree-row'}>
              <span className="tree-twist" aria-hidden="true" />
              <button type="button" className="tree-pick" onClick={() => pickPath([])}>
                <span className="tree-san">Start</span>
              </button>
              {tree.moves.length > 0 ? (
                <span className="tree-bulk">
                  <button type="button" className="tree-bulk-btn" onClick={expandWholeTree}>
                    Expand all
                  </button>
                  <button type="button" className="tree-bulk-btn" onClick={collapseWholeTree}>
                    Collapse all
                  </button>
                </span>
              ) : null}
            </div>
            {tree.moves.length > 0 ? (
              <ul className="tree" role="tree">
                <TreeRows
                  nodes={tree.moves}
                  depth={0}
                  selected={path}
                  expanded={expanded}
                  onPick={pickPath}
                  onToggle={toggleExpanded}
                  onExpandAll={expandAllUnder}
                  onCollapseAll={collapseAllUnder}
                />
              </ul>
            ) : null}
          </div>
          {only ? (
            <button
              className="btn warn"
              type="button"
              onClick={() => {
                if (confirm === only.id) {
                  void data.deleteLine(only.id)
                  setConfirm(null)
                  setPath([])
                } else setConfirm(only.id)
              }}
            >
              {confirm === only.id ? 'Confirm remove' : `Remove ${only.name}`}
            </button>
          ) : null}
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
      {only ? (
        <button className="btn secondary" type="button" onClick={() => go(`/o/${active.id}/practice/${only.id}`)}>
          Practice this line
        </button>
      ) : null}
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
  onExpandAll,
  onCollapseAll,
}: {
  nodes: TreeMove[]
  depth: number
  selected: string[]
  expanded: Set<string>
  onPick: (path: string[]) => void
  onToggle: (key: string, path: string[]) => void
  onExpandAll: (node: TreeMove) => void
  onCollapseAll: (node: TreeMove, path: string[]) => void
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
              {hasChildren ? (
                <span className="tree-bulk">
                  <button
                    type="button"
                    className="tree-bulk-btn"
                    aria-label={`Expand all under ${node.moveLabel}`}
                    onClick={() => onExpandAll(node)}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    className="tree-bulk-btn"
                    aria-label={`Collapse all under ${node.moveLabel}`}
                    onClick={() => onCollapseAll(node, node.path)}
                  >
                    Collapse all
                  </button>
                </span>
              ) : null}
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
                  onExpandAll={onExpandAll}
                  onCollapseAll={onCollapseAll}
                />
              </ul>
            ) : null}
          </li>
        )
      })}
    </>
  )
}
