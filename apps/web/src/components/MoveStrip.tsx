import { sideToMove } from '@opening/engine'

export function MoveStrip({
  startFen,
  moves,
  at,
  onPick,
}: {
  startFen: string
  moves: string[]
  at: number
  onPick: (index: number) => void
}) {
  if (moves.length === 0) return <span className="quiet">No moves yet</span>
  const whiteStarts = sideToMove(startFen) === 'white'
  return (
    <>
      {moves.map((san, ply) => {
        const whiteMove = whiteStarts ? ply % 2 === 0 : ply % 2 === 1
        const number = Math.floor((ply + (whiteStarts ? 0 : 1)) / 2) + 1
        const label = whiteMove ? `${number}. ${san}` : ply === 0 ? `${number}... ${san}` : san
        const className = ply === at - 1 ? 'board-ply current' : ply < at ? 'board-ply played' : 'board-ply ahead'
        return (
          <button key={`${ply}-${san}`} type="button" className={className} onClick={() => onPick(ply)}>
            {label}
          </button>
        )
      })}
    </>
  )
}
