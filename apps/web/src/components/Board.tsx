import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'
import type { Key } from '@lichess-org/chessground/types'
import { checkedSide, legalDests, sideToMove, START_FEN, type Color } from '@opening/engine'
import { useEffect, useRef, useState } from 'react'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'

type BoardProps = {
  fen: string
  orientation: Color
  interactive: boolean
  /** Select your pieces and see their moves before it is your turn. */
  preview?: boolean
  /** Bump this to put pieces back after a move the line did not accept. */
  epoch?: number
  lastMove?: [string, string]
  onMove?: (from: string, to: string) => void
}

export function Board({ fen, orientation, interactive, preview = false, epoch = 0, lastMove, onMove }: BoardProps) {
  const host = useRef<HTMLDivElement>(null)
  const ground = useRef<Api | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const shown = fen || START_FEN
  const shownRef = useRef(shown)
  const interactiveRef = useRef(interactive)
  const previewRef = useRef(preview)
  shownRef.current = shown
  interactiveRef.current = interactive
  previewRef.current = preview
  const [held, setHeld] = useState<{ fen: string; square: string } | null>(null)
  const epochRef = useRef(epoch)

  useEffect(() => {
    const element = host.current
    if (!element) return
    ground.current = Chessground(element, {
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      movable: { free: false, showDests: true },
      premovable: { enabled: false },
      draggable: { enabled: true, distance: 3, autoDistance: false },
      disableContextMenu: true,
      trustAllEvents: true,
      events: {
        select: (key) => {
          if (interactiveRef.current || !previewRef.current) return
          const position = shownRef.current
          const origins = legalDests(position)
          if (!origins.has(key)) {
            setHeld(null)
            return
          }
          setHeld((current) =>
            current && current.fen === position && current.square === key ? null : { fen: position, square: key },
          )
        },
      },
    })
    const resize = () => {
      const width = element.clientWidth
      if (!width) return
      element.style.height = `${width}px`
      ground.current?.redrawAll()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => {
      observer.disconnect()
      ground.current?.destroy()
      ground.current = null
    }
  }, [])

  useEffect(() => {
    const epochChanged = epochRef.current !== epoch
    epochRef.current = epoch
    const kept = !epochChanged && held && held.fen === shown ? held.square : null
    if (epochChanged && held) setHeld(null)

    const canMove = interactive
    const canSelect = interactive || preview
    const dests = new Map<Key, Key[]>()
    if (canMove) {
      for (const [from, targets] of legalDests(shown)) dests.set(from as Key, targets as Key[])
    }
    const turn = sideToMove(shown)
    const marks = new Map<Key, string>()
    if (!canMove && kept) {
      const occupied = occupiedSquares(shown)
      for (const target of legalDests(shown).get(kept) ?? []) {
        marks.set(target as Key, occupied.has(target) ? 'move-dest oc' : 'move-dest')
      }
    }
    const config: Config = {
      fen: shown,
      orientation,
      turnColor: turn,
      lastMove: lastMove as Key[] | undefined,
      check: checkedSide(shown) ?? false,
      // Chessground attaches click listeners only while viewOnly is false,
      // and a later change does not put them back. Block moves with dests
      // instead of turning the board view-only.
      viewOnly: false,
      trustAllEvents: true,
      coordinates: true,
      highlight: { lastMove: true, check: true, custom: marks },
      animation: { enabled: true, duration: 180 },
      selectable: { enabled: canSelect },
      // Dragging would commit a preview click. Selection is enough until the turn arrives.
      draggable: { enabled: canMove, distance: 3, autoDistance: false },
      movable: {
        free: false,
        color: canSelect ? turn : undefined,
        dests,
        showDests: true,
        events: {
          after: (from, to) => onMoveRef.current?.(from, to),
        },
      },
    }
    if (kept) config.selected = kept as Key
    else if (!canMove || epochChanged) config.selected = undefined
    ground.current?.set(config)
  }, [shown, orientation, interactive, preview, lastMove, held, epoch])

  return (
    <div className="board-frame">
      <div ref={host} className="board-target" aria-label="Chessboard" />
    </div>
  )
}

function occupiedSquares(fen: string): Set<string> {
  const occupied = new Set<string>()
  const rows = fen.split(' ')[0]?.split('/') ?? []
  rows.forEach((row, rankIndex) => {
    let file = 0
    for (const char of row) {
      if (char >= '1' && char <= '8') file += Number(char)
      else {
        occupied.add(`${String.fromCharCode(97 + file)}${8 - rankIndex}`)
        file += 1
      }
    }
  })
  return occupied
}

const PROMOTIONS = [
  ['q', 'Queen'],
  ['r', 'Rook'],
  ['b', 'Bishop'],
  ['n', 'Knight'],
] as const

export function PromotionPicker({ onPick }: { onPick: (piece: 'q' | 'r' | 'b' | 'n') => void }) {
  return (
    <div className="promo" role="group" aria-label="Choose a promotion">
      {PROMOTIONS.map(([piece, label]) => (
        <button key={piece} className="btn secondary" type="button" onClick={() => onPick(piece)}>
          {label}
        </button>
      ))}
    </div>
  )
}
