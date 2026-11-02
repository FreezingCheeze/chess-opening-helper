export type Color = 'white' | 'black'

export type Step = {
  san: string
  comment?: string
}

export type LineInput = {
  id: string
  name: string
  groupName: string
  pgn: string
}

export type DraftLine = {
  id: string
  name: string
  groupName: string
  pgn: string
  included: boolean
  yourChoice: boolean
}

export type MoveRecord = {
  san: string
  lineId: string
  lineName: string
  groupName: string
  comment?: string
}

export type PositionNode = {
  key: string
  fen: string
  opponentMoves: MoveRecord[]
  myMoves: MoveRecord[]
}

export type Conflict = {
  key: string
  options: { lineId: string; lineName: string; san: string }[]
}

export type Compiled = {
  nodes: Map<string, PositionNode>
  conflicts: Conflict[]
}

export type ProgressMark = {
  positionKey: string
  expectedSan: string
  introduced: boolean
  needsReview: boolean
}

export type PracticeStep = {
  type: 'opponent' | 'introduce' | 'ask'
  san: string
  fenBefore: string
  fenAfter: string
  positionKey: string
  comment?: string
  label?: string
  lineId: string
}

export type SessionEvent =
  | { type: 'introduced'; positionKey: string; san: string; lineId: string }
  | { type: 'correct'; positionKey: string; san: string; lineId: string }
  | { type: 'miss'; positionKey: string; san: string; lineId: string }

export type MoveRow = {
  who: string
  san: string
  comment?: string
}
