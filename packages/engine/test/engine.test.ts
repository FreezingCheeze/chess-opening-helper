import { describe, expect, it } from 'vitest'
import {
  addRepertoireMove,
  answer,
  applySan,
  caroKannLines,
  pgnForMoves,
  repertoireAdjustments,
  beginReplay,
  chooseLearning,
  compile,
  continueAfterLine,
  continueAfterWrong,
  createSession,
  currentStep,
  editorChoices,
  editorDrafts,
  findMove,
  firstPath,
  importPgn,
  lichessStudyId,
  newEditor,
  next,
  pathNotation,
  playSan,
  positionKey,
  readableRows,
  repertoireOf,
  resetDraftIds,
  rewindForOpponentTry,
  sessionView,
  showMove,
  sideToMove,
  START_FEN,
  studyView,
  undoEditor,
} from '../src/index'

const caro = `
1. e4 c6 2. d4 d5 3. Nc3 (3. exd5 {Exchange} cxd5) (3. f3 {Fantasy} dxe4) dxe4 {Classical} 4. Nxe4 Bf5 *
`

describe('PGN import', () => {
  it('splits opponent tries into named lines and leaves them for later', () => {
    resetDraftIds()
    const { drafts, error } = importPgn(caro, 'black')
    expect(error).toBeUndefined()
    expect(drafts.map((line) => line.name)).toEqual(['Classical', 'Exchange', 'Fantasy'])
    expect(drafts.every((line) => line.included === false)).toBe(true)
    expect(drafts.every((line) => line.yourChoice === false)).toBe(true)
    expect(readableRows(drafts[1].pgn, 'black').map((row) => `${row.who} ${row.san}`)).toContain('White exd5')
  })

  it('marks a second reply of your own', () => {
    resetDraftIds()
    const { drafts } = importPgn('1. e4 c6 2. d4 d5 3. Nc3 dxe4 (3... Nf6) *', 'black')
    expect(drafts).toHaveLength(2)
    expect(drafts.every((line) => line.yourChoice)).toBe(true)
  })

  it('uses chapter names as groups', () => {
    resetDraftIds()
    const { drafts } = importPgn(
      `[Event "Caro"]
[ChapterName "Exchange"]

1. e4 c6 2. d4 d5 3. exd5 cxd5 *

[Event "Caro"]
[ChapterName "Fantasy"]

1. e4 c6 2. d4 d5 3. f3 dxe4 *`,
      'black',
    )
    expect(drafts.map((line) => [line.groupName, line.name])).toEqual([
      ['Exchange', 'Main line'],
      ['Fantasy', 'Main line'],
    ])
  })

  it('replays castling, promotion, and a knight disambiguation', () => {
    const { drafts, error } = importPgn(
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 *',
      'white',
    )
    expect(error).toBeUndefined()
    expect(drafts).toHaveLength(1)
    const rows = readableRows(drafts[0].pgn, 'white')
    expect(rows.some((row) => row.san === 'O-O')).toBe(true)
    expect(rows.some((row) => row.san === 'Nbd7')).toBe(true)
    const promoted = importPgn('1. a4 b5 2. axb5 a6 3. bxa6 Bb7 4. axb7 Nf6 5. bxa8=Q *', 'white')
    expect(promoted.error).toBeUndefined()
    expect(readableRows(promoted.drafts[0].pgn, 'white').some((row) => row.san === 'bxa8=Q')).toBe(true)
  })

  it('strips lichess arrow comments and keeps the sentence', () => {
    const { drafts } = importPgn('1. e4 {[%cal Ge2e4] A king pawn opening.} e5 *', 'white')
    expect(readableRows(drafts[0].pgn, 'white')[0].comment).toBe('A king pawn opening.')
  })

  it('rejects a link pasted into the PGN box', () => {
    const { error } = importPgn('https://lichess.org/study/abcdefgh', 'black')
    expect(error).toMatch(/Lichess/)
  })

  it('reads a lichess study id from a url', () => {
    expect(lichessStudyId('https://lichess.org/study/wvK4w9yO/abcd1234')).toBe('wvK4w9yO')
  })
})

describe('merge', () => {
  it('keeps every opponent try and one reply for you', () => {
    resetDraftIds()
    const { drafts } = importPgn(caro, 'black')
    const learning = drafts.map((line) => ({ ...line, included: true }))
    const compiled = compile(learning, 'black')
    const afterD5 = [...compiled.nodes.values()].find((node) => node.opponentMoves.some((move) => move.san === 'Nc3'))
    expect(afterD5?.opponentMoves.map((move) => move.san).sort()).toEqual(['Nc3', 'exd5', 'f3'])
    expect(compiled.conflicts).toHaveLength(0)
  })

  it('reports two replies of your own in the same position', () => {
    resetDraftIds()
    const { drafts } = importPgn('1. e4 c6 2. d4 d5 3. Nc3 dxe4 (3... Nf6) *', 'black')
    const compiled = compile(
      drafts.map((line) => ({ ...line, included: true })),
      'black',
    )
    expect(compiled.conflicts).toHaveLength(1)
    expect(compiled.conflicts[0].options.map((option) => option.san).sort()).toEqual(['Nf6', 'dxe4'])
  })

  it('turns the other line off when you choose one reply', () => {
    resetDraftIds()
    const { drafts } = importPgn('1. e4 c6 2. d4 d5 3. Nc3 dxe4 (3... Nf6) *', 'black')
    const chosen = chooseLearning(drafts, drafts[0].id, true, 'black')
    const second = chooseLearning(chosen.drafts, drafts[1].id, true, 'black')
    expect(second.drafts.find((line) => line.id === drafts[1].id)?.included).toBe(true)
    expect(second.drafts.find((line) => line.id === drafts[0].id)?.included).toBe(false)
  })

  it('ignores move clocks when matching a position', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 5 9'),
    )
  })
})

describe('practice session', () => {
  it('shows your move once, then asks you to play it', () => {
    const line = {
      id: 'line-1',
      name: 'Main line',
      groupName: 'Exchange',
      pgn: '1. e4 c6 2. d4 d5 *',
    }
    let session = createSession([line], 'black', [])
    const first = sessionView(session, [line], 'black')
    expect(first.prompt).toMatch(/White plays e4/)
    session = next(session).session
    const intro = sessionView(session, [line], 'black')
    expect(intro.prompt).toBe('Your move here is c6.')
    expect(intro.interactive).toBe(false)
    session = next(session).session
    const ask = sessionView(session, [line], 'black')
    expect(ask.prompt).toBe('Your move')
    expect(ask.interactive).toBe(true)
    const wrong = answer(session, 'e5')
    expect(wrong.session.phase).toBe('wrong')
    const missed = sessionView(wrong.session, [line], 'black')
    expect(missed.prompt).toBe('That’s not the move in this line.')
    expect(missed.interactive).toBe(true)
    expect(missed.fen).toBe(ask.fen)
    const again = answer(wrong.session, 'Nf6')
    expect(again.session.phase).toBe('wrong')
    expect(again.events).toHaveLength(0)
    const corrected = answer(wrong.session, 'c6')
    expect(corrected.events[0]?.type).toBe('correct')
    const revealed = showMove(wrong.session)
    expect(sessionView(revealed.session, [line], 'black').prompt).toBe('The move in your line is c6.')
    expect(sessionView(revealed.session, [line], 'black').interactive).toBe(false)
  })

  it('skips the introduction after you have seen the move', () => {
    const line = { id: 'line-1', name: 'Main line', groupName: 'Lines', pgn: '1. e4 c6 *' }
    const session = createSession(
      [line],
      'black',
      [{ positionKey: currentKeyAfterE4(), expectedSan: 'c6', introduced: true, needsReview: false }],
    )
    const afterWhite = next(session).session
    expect(currentStep(afterWhite)?.type).toBe('ask')
  })

  it('brings a missed line back once', () => {
    const line = { id: 'line-1', name: 'Main line', groupName: 'Lines', pgn: '1. e4 c6 *' }
    let session = createSession([line], 'black', [])
    session = next(session).session
    session = next(session).session
    session = answer(session, 'e5').session
    session = showMove(session).session
    expect(sessionView(session, [line], 'black').prompt).toBe('The move in your line is c6. This is the end of the line.')
    const continued = continueAfterWrong(session)
    expect(continued.session.phase).toBe('replay')
    expect(continued.events[0].type).toBe('miss')
    const replay = beginReplay(continued.session)
    expect(replay.phase).toBe('play')
    const again = replay.rounds.filter((round) => round.replay)
    expect(again).toHaveLength(1)
    expect(again[0].steps.some((step) => step.type === 'introduce')).toBe(false)
    expect(again[0].steps.some((step) => step.type === 'ask')).toBe(true)
  })

  it('stays on the final position until you continue', () => {
    const first = { id: 'line-1', name: 'Classical', groupName: 'Caro', pgn: '1. e4 c6 *' }
    const second = { id: 'line-2', name: 'Exchange', groupName: 'Caro', pgn: '1. e4 c6 2. d4 d5 *' }
    let session = createSession(
      [first, second],
      'black',
      [{ positionKey: currentKeyAfterE4(), expectedSan: 'c6', introduced: true, needsReview: false }],
    )
    session = next(session).session
    const played = answer(session, 'c6')
    expect(played.session.phase).toBe('lineEnd')
    const end = sessionView(played.session, [first, second], 'black')
    expect(end.prompt).toBe('This is the end of the line.')
    expect(end.interactive).toBe(false)
    expect(end.fen).not.toBe(sessionView(session, [first, second], 'black').fen)
    const nextLine = continueAfterLine(played.session)
    expect(nextLine.session.phase).toBe('play')
    expect(nextLine.session.round).toBe(1)
    expect(sessionView(nextLine.session, [first, second], 'black').prompt).toMatch(/White plays e4/)
  })
})

describe('study and editor', () => {
  it('shows opponent tries as separate branches', () => {
    resetDraftIds()
    const { drafts } = importPgn(caro, 'black')
    const lines = drafts.map((line) => ({ ...line, included: true }))
    const start = studyView(lines, 'black', [])
    expect(start.continueSan).toBe('e4')
    expect(start.branches).toHaveLength(0)
    const view = studyView(lines, 'black', ['e4', 'c6', 'd4', 'd5'])
    expect(view.branches.map((branch) => branch.san).sort()).toEqual(['Nc3', 'exd5', 'f3'])
    expect(view.youToMove).toBe(false)
  })

  it('adds another try for the other side without deleting the first', () => {
    let state = newEditor('black')
    for (const san of ['e4', 'c6', 'd4', 'd5', 'Nc3']) {
      const nextState = playSan(state, san)
      if ('error' in nextState) throw new Error(nextState.error)
      state = nextState
    }
    state = rewindForOpponentTry(state)
    expect(editorChoices(state).map((move) => move.san)).toEqual(['Nc3'])
    const branched = playSan(state, 'exd5')
    if ('error' in branched) throw new Error(branched.error)
    const drafts = editorDrafts(branched, 'Caro', 'Black')
    expect(drafts).toHaveLength(2)
    expect(drafts.every((line) => line.included)).toBe(true)
    state = undoEditor(branched)
    expect(editorChoices(state).map((move) => move.san)).toEqual(['Nc3'])
  })
})

describe('repertoire tree', () => {
  const lines = () => {
    resetDraftIds()
    return importPgn(caro, 'black').drafts.map((line) => ({ ...line, included: line.name === 'Classical' }))
  }

  it('shows every variation, including ones set aside', () => {
    const tree = repertoireOf(lines(), 'black')
    const d5 = findMove(tree, ['e4', 'c6', 'd4', 'd5'])
    expect(d5?.children.map((move) => move.san).sort()).toEqual(['Nc3', 'exd5', 'f3'])
    const classical = d5?.children.find((move) => move.san === 'Nc3')
    const exchange = d5?.children.find((move) => move.san === 'exd5')
    expect(classical?.badge).toBe('Classical')
    expect(classical?.learningCount).toBe(1)
    expect(exchange?.badge).toBe('Exchange')
    expect(exchange?.learningCount).toBe(0)
    expect(classical?.moveLabel).toBe('3. Nc3')
    expect(findMove(tree, ['e4', 'c6'])?.moveLabel).toBe('1... c6')
    expect(pathNotation(tree.fen, ['e4', 'c6', 'd4', 'd5', 'Nc3'])).toBe('1. e4 c6 2. d4 d5 3. Nc3')
  })

  it('extends the line that ends on the selected move', () => {
    const classical = lines().find((line) => line.name === 'Classical')
    if (!classical) throw new Error('missing classical')
    const result = addRepertoireMove(
      [classical],
      'black',
      ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'],
      'Ng3',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.path.at(-1)).toBe('Ng3')
    const update = result.patches.find((patch) => patch.type === 'update' && patch.pgn)
    if (!update || update.type !== 'update' || !update.pgn) throw new Error('missing pgn update')
    expect(firstPath(update.pgn)?.moves.map((move) => move.san)).toEqual([
      'e4',
      'c6',
      'd4',
      'd5',
      'Nc3',
      'dxe4',
      'Nxe4',
      'Bf5',
      'Ng3',
    ])
  })

  it('adds another white try without turning the others off', () => {
    const stored = lines()
    const result = addRepertoireMove(stored, 'black', ['e4', 'c6', 'd4', 'd5'], 'c4')
    if ('error' in result) throw new Error(result.error)
    expect(result.patches.some((patch) => patch.type === 'update' && patch.included === false)).toBe(false)
    expect(result.patches).toContainEqual(expect.objectContaining({ type: 'create', name: 'c4', included: true }))
  })

  it('sets the previous reply aside when you add a different one', () => {
    const classical = lines().find((line) => line.name === 'Classical')
    if (!classical) throw new Error('missing classical')
    const result = addRepertoireMove(classical ? [{ ...classical, included: true }] : [], 'black', ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4'], 'Be6')
    if ('error' in result) throw new Error(result.error)
    expect(result.patches).toContainEqual({ type: 'update', id: classical.id, included: false })
    expect(result.patches).toContainEqual(expect.objectContaining({ type: 'create', name: 'Be6', included: true }))
  })
})

describe('Caro-Kann repertoire', () => {
  it('keeps a single black reply at every position', () => {
    const replies = new Map<string, string>()
    const groups = new Set<string>()
    for (const line of caroKannLines) {
      groups.add(line.groupName)
      let fen = START_FEN
      for (const san of line.moves) {
        if (sideToMove(fen) === 'black') {
          const key = fen.split(' ').slice(0, 4).join(' ')
          const previous = replies.get(key)
          expect(previous ?? san).toBe(san)
          replies.set(key, san)
        }
        const applied = applySan(fen, san)
        expect(applied, `${line.slug} ${san}`).not.toBeNull()
        fen = applied!.fen
      }
      expect(sideToMove(fen)).toBe('white')
    }
    expect(groups).toEqual(new Set(['Classical', 'Advance', 'Exchange', 'Fantasy']))
    expect(caroKannLines.length).toBeGreaterThanOrEqual(50)
    expect(replies.size).toBeGreaterThan(20)
    expect(
      compile(
        caroKannLines.map((line) => ({
          id: line.slug,
          name: line.name,
          groupName: line.groupName,
          pgn: pgnForMoves(line.moves),
        })),
        'black',
      ).conflicts,
    ).toHaveLength(0)
  })

  it('replaces a short line and sets a different black reply aside', () => {
    const short = '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 *'
    const sharp = '1. e4 c6 2. d4 d5 3. f3 dxe4 *'
    const result = repertoireAdjustments(
      [
        { id: 'short', pgn: short, included: true },
        { id: 'sharp', pgn: sharp, included: true },
        { id: 'kept', pgn: '1. d4 d5 *', included: true },
      ],
      caroKannLines,
    )
    expect(result.deleteIds).toEqual(['short'])
    expect(result.laterIds).toEqual(['sharp'])
    expect(result.deleteIds).not.toContain('kept')
  })
})

function currentKeyAfterE4(): string {
  const line = { id: 'x', name: 'x', groupName: 'x', pgn: '1. e4 e5 *' }
  const session = createSession([line], 'black', [])
  const step = currentStep(next(session).session)
  return step?.positionKey ?? ''
}
