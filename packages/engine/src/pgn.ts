import { applySan, normalizeFen, otherColor, sideToMove, START_FEN } from './chess'
import type { Color, DraftLine, MoveRow, Step } from './types'

type ParsedMove = {
  san: string
  comment?: string
  sidelines: ParsedMove[][]
}

type ParsedGame = {
  tags: Record<string, string>
  startFen: string
  paths: Step[][]
}

const GENERIC_GROUPS = new Set(['', 'Imported', 'Lines'])

function cleanComment(value: string): string | undefined {
  const stripped = value
    .replace(/\[%(?:cal|csl|clk|eval|emt)[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped || undefined
}

function joinComment(left?: string, right?: string): string | undefined {
  return cleanComment([left, right].filter(Boolean).join(' '))
}

type Token =
  | { t: 'san'; v: string }
  | { t: '(' }
  | { t: ')' }
  | { t: 'comment'; v: string }

const SAN_RE =
  /^(?:O-O-O|O-O|0-0-0|0-0|[NBRQK][a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?|[a-h]x[a-h][1-8](?:=[NBRQ])?[+#]?|[a-h][1-8](?:=[NBRQ])?[+#]?)/

function canonicalSan(raw: string): string {
  if (/^0-0-0$/i.test(raw)) return 'O-O-O'
  if (/^0-0$/i.test(raw)) return 'O-O'
  if (/^[a-h]/.test(raw)) return raw
  return raw[0].toUpperCase() + raw.slice(1)
}

function tokenize(input: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '{') {
      const end = input.indexOf('}', i + 1)
      if (end === -1) return { tokens, error: 'A comment is missing its closing brace.' }
      const comment = cleanComment(input.slice(i + 1, end))
      if (comment) tokens.push({ t: 'comment', v: comment })
      i = end + 1
      continue
    }
    if (ch === ';') {
      const end = input.indexOf('\n', i + 1)
      const comment = cleanComment(input.slice(i + 1, end === -1 ? input.length : end))
      if (comment) tokens.push({ t: 'comment', v: comment })
      i = end === -1 ? input.length : end + 1
      continue
    }
    if (ch === '(') {
      tokens.push({ t: '(' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ t: ')' })
      i += 1
      continue
    }
    if (ch === '$') {
      i += 1
      while (i < input.length && /\d/.test(input[i])) i += 1
      continue
    }
    if (input.startsWith('1-0', i) || input.startsWith('0-1', i) || input.startsWith('1/2-1/2', i)) {
      i += input.startsWith('1/2-1/2', i) ? 7 : 3
      continue
    }
    if (ch === '*') {
      i += 1
      continue
    }
    const sanMatch = SAN_RE.exec(input.slice(i))
    if (sanMatch) {
      let raw = sanMatch[0]
      i += raw.length
      while (i < input.length && (input[i] === '!' || input[i] === '?')) i += 1
      tokens.push({ t: 'san', v: canonicalSan(raw) })
      continue
    }
    if (/\d/.test(ch)) {
      while (i < input.length && /\d/.test(input[i])) i += 1
      while (i < input.length && input[i] === '.') i += 1
      continue
    }
    const snippet = input.slice(i, i + 24).trim()
    return { tokens, error: `Could not read the moves near "${snippet}".` }
  }
  return { tokens }
}

function parseMoves(tokens: Token[], index: number): { moves: ParsedMove[]; index: number } {
  const moves: ParsedMove[] = []
  let i = index
  while (i < tokens.length) {
    if (tokens[i].t === ')') break
    let commentBefore: string | undefined
    while (tokens[i]?.t === 'comment') {
      const token = tokens[i]
      if (token?.t !== 'comment') break
      commentBefore = joinComment(commentBefore, token.v)
      i += 1
    }
    const sanToken = tokens[i]
    if (sanToken?.t !== 'san') break
    const san = sanToken.v
    i += 1
    let commentAfter: string | undefined
    while (tokens[i]?.t === 'comment') {
      const token = tokens[i]
      if (token?.t !== 'comment') break
      commentAfter = joinComment(commentAfter, token.v)
      i += 1
    }
    const sidelines: ParsedMove[][] = []
    while (tokens[i]?.t === '(') {
      i += 1
      const side = parseMoves(tokens, i)
      i = side.index
      if (tokens[i]?.t === ')') i += 1
      if (side.moves.length > 0) sidelines.push(side.moves)
    }
    moves.push({ san, comment: joinComment(commentBefore, commentAfter), sidelines })
  }
  return { moves, index: i }
}

function expand(moves: ParsedMove[], prefix: Step[]): Step[][] {
  if (moves.length === 0) return [prefix.slice()]
  const [head, ...tail] = moves
  const step: Step = { san: head.san, comment: head.comment }
  const main = expand(tail, [...prefix, step])
  const sides = head.sidelines.flatMap((side) => expand(side, prefix.slice()))
  return [...main, ...sides]
}

function splitGames(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const chunks: string[][] = []
  let current: string[] = []
  let sawMoves = false
  for (const line of lines) {
    const isTag = /^\s*\[/.test(line)
    if (isTag && sawMoves) {
      chunks.push(current)
      current = [line]
      sawMoves = false
      continue
    }
    const trimmed = line.trim()
    if (trimmed && !isTag && !trimmed.startsWith('%')) sawMoves = true
    current.push(line)
  }
  if (current.some((line) => line.trim())) chunks.push(current)
  return chunks.map((chunk) => chunk.join('\n')).filter((chunk) => chunk.trim())
}

function readTags(chunk: string): { tags: Record<string, string>; movetext: string } {
  const tags: Record<string, string> = {}
  const moveLines: string[] = []
  let inMoves = false
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!inMoves) {
      const match = /^\[([A-Za-z0-9_]+)\s+"(.*)"\]$/.exec(trimmed)
      if (match) {
        tags[match[1]] = match[2]
        continue
      }
      if (!trimmed || trimmed.startsWith('%')) continue
      inMoves = true
    }
    if (!trimmed.startsWith('%')) moveLines.push(line)
  }
  return { tags, movetext: moveLines.join('\n') }
}

function legalPaths(startFen: string, paths: Step[][]): { paths: Step[][]; illegal?: string } {
  const accepted: Step[][] = []
  const seen = new Set<string>()
  let illegal: string | undefined
  for (const path of paths) {
    let fen = startFen
    const steps: Step[] = []
    let ok = true
    for (const step of path) {
      const applied = applySan(fen, step.san)
      if (!applied) {
        ok = false
        illegal = step.san
        break
      }
      steps.push({ ...step, san: applied.san })
      fen = applied.fen
    }
    if (!ok || steps.length === 0) continue
    const signature = steps.map((step) => step.san).join(' ')
    if (seen.has(signature)) continue
    seen.add(signature)
    accepted.push(steps)
  }
  return { paths: accepted, illegal }
}

function parseGame(chunk: string): { game?: ParsedGame; error?: string } {
  const { tags, movetext } = readTags(chunk)
  if (!movetext.trim()) return {}
  const setup = tags.SetUp === '1' || tags.Setup === '1'
  const startFen = setup && tags.FEN ? normalizeFen(tags.FEN) : START_FEN
  if (!startFen) return { error: 'The FEN tag in that PGN could not be read.' }
  const tokenized = tokenize(movetext)
  if (tokenized.error) return { error: tokenized.error }
  const parsed = parseMoves(tokenized.tokens, 0)
  const legal = legalPaths(startFen, expand(parsed.moves, []))
  if (legal.paths.length === 0) {
    const detail = legal.illegal ? ` ${legal.illegal} is not legal in that line.` : ''
    return { error: `Those moves could not be read as a chess line.${detail}` }
  }
  return { game: { tags, startFen, paths: legal.paths } }
}

export function toPgn(startFen: string, moves: Step[]): string {
  const headers: string[] = []
  if (positionDiffers(startFen, START_FEN)) {
    headers.push('[SetUp "1"]', `[FEN "${startFen}"]`)
  }
  const body: string[] = []
  let fen = startFen
  moves.forEach((step, index) => {
    const turn = sideToMove(fen)
    const moveNumber = Number(fen.split(' ')[5] || '1')
    if (turn === 'white') body.push(`${moveNumber}.`)
    else if (index === 0) body.push(`${moveNumber}...`)
    body.push(step.san)
    if (step.comment) body.push(`{${step.comment.replace(/[{}]/g, '')}}`)
    const applied = applySan(fen, step.san)
    if (applied) fen = applied.fen
  })
  body.push('*')
  const movetext = body.join(' ')
  return headers.length ? `${headers.join('\n')}\n\n${movetext}\n` : `${movetext}\n`
}

function positionDiffers(left: string, right: string): boolean {
  return left.split(' ').slice(0, 4).join(' ') !== right.split(' ').slice(0, 4).join(' ')
}

function sideAtPly(startFen: string, ply: number): Color {
  const start = sideToMove(startFen)
  if (ply % 2 === 0) return start
  return otherColor(start)
}

function labelAt(path: Step[], index: number): string {
  return path[index].comment || path.slice(index).find((step) => step.comment)?.comment || path[index].san
}

function divergence(path: Step[], others: Step[][]): { index: number; label: string } | null {
  for (const other of others) {
    const limit = Math.min(path.length, other.length)
    let index = 0
    while (index < limit && path[index].san === other[index].san) index += 1
    if (index < path.length && (index >= other.length || path[index].san !== other[index].san)) {
      return { index, label: labelAt(path, index) }
    }
  }
  return null
}

function shortLabel(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? `${clean.slice(0, 45).trim()}…` : clean
}

let draftCounter = 0

function nextDraftId(): string {
  draftCounter += 1
  return `draft-${draftCounter}`
}

export function resetDraftIds(): void {
  draftCounter = 0
}

function draftsFromGame(game: ParsedGame, myColor: Color): DraftLine[] {
  const groupName = game.tags.ChapterName?.trim() || 'Imported'
  return game.paths.map((path) => {
    const fork = divergence(path, game.paths.filter((other) => other !== path))
    const several = game.paths.length > 1
    const name = several ? shortLabel(fork?.label || 'Line') : 'Main line'
    const yourChoice = fork ? sideAtPly(game.startFen, fork.index) === myColor : false
    return {
      id: nextDraftId(),
      name,
      groupName,
      pgn: toPgn(game.startFen, path),
      included: false,
      yourChoice,
    }
  })
}

export function importPgn(pgnText: string, myColor: Color): { drafts: DraftLine[]; error?: string } {
  const text = pgnText.trim()
  if (!text) return { drafts: [], error: 'Paste a game or a line first.' }
  if (/^https?:\/\//i.test(text)) {
    return { drafts: [], error: 'That looks like a link. Use the Lichess study option for a study link.' }
  }
  const errors: string[] = []
  const drafts: DraftLine[] = []
  for (const chunk of splitGames(text)) {
    const parsed = parseGame(chunk)
    if (parsed.error) errors.push(parsed.error)
    if (parsed.game) drafts.push(...draftsFromGame(parsed.game, myColor))
  }
  if (drafts.length === 0) {
    return { drafts: [], error: errors[0] || 'Those moves could not be read. Paste PGN from Lichess or Chess.com.' }
  }
  return { drafts }
}

export function firstPath(pgn: string): { startFen: string; moves: Step[] } | null {
  const chunk = splitGames(pgn)[0]
  if (!chunk) return null
  const parsed = parseGame(chunk)
  const path = parsed.game?.paths[0]
  if (!parsed.game || !path) return null
  return { startFen: parsed.game.startFen, moves: path }
}

export function allPaths(pgn: string): { startFen: string; moves: Step[] }[] {
  const paths: { startFen: string; moves: Step[] }[] = []
  for (const chunk of splitGames(pgn)) {
    const parsed = parseGame(chunk)
    if (!parsed.game) continue
    for (const path of parsed.game.paths) paths.push({ startFen: parsed.game.startFen, moves: path })
  }
  return paths
}

export function readableRows(pgn: string, myColor: Color): MoveRow[] {
  const path = firstPath(pgn)
  if (!path) return []
  const rows: MoveRow[] = []
  let fen = path.startFen
  for (const step of path.moves) {
    const side = sideToMove(fen)
    rows.push({
      who: side === myColor ? 'You' : side === 'white' ? 'White' : 'Black',
      san: step.san,
      comment: step.comment,
    })
    const applied = applySan(fen, step.san)
    if (!applied) break
    fen = applied.fen
  }
  return rows
}

export function lichessStudyId(input: string): string | null {
  const trimmed = input.trim()
  const fromUrl = /lichess\.org\/study\/([A-Za-z0-9]{6,12})/i.exec(trimmed)
  if (fromUrl) return fromUrl[1]
  if (/^[A-Za-z0-9]{8}$/.test(trimmed)) return trimmed
  return null
}

export function isGenericGroup(name: string): boolean {
  return GENERIC_GROUPS.has(name.trim())
}
