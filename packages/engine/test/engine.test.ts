import { describe, expect, it } from 'vitest'
import {
  addRepertoireMove,
  allPaths,
  answer,
  applySan,
  caroKannLines,
  pgnForMoves,
  repertoireAdjustments,
  chooseLearning,
  compile,
  createSession,
  currentStep,
  editorChoices,
  editorDrafts,
  findMove,
  firstPath,
  hideMove,
  importPgn,
  learningImpact,
  lichessStudyId,
  mainPathFrom,
  nearestPath,
  newEditor,
  next,
  pathNotation,
  pathPrefix,
  planAdditions,
  planBranchRemoval,
  playSan,
  practiceConflicts,
  positionKey,
  readableRows,
  repertoireOf,
  resetDraftIds,
  retainedSeedIds,
  retryMisses,
  retryRound,
  rewindForOpponentTry,
  sessionView,
  showMove,
  sideToMove,
  START_FEN,
  studyView,
  undoEditor,
  variationLines,
  withPreferredMove,
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
    expect(error).toMatch(/Paste the PGN/i)
  })

  it('keeps earlier games when a later game is illegal', () => {
    resetDraftIds()
    const { drafts, error, warnings } = importPgn(
      '1. e4 e5 2. Nf3 Nc6 3. d4 {Scotch} (3. Bb5 {Spanish} a6) exd4 *\n\n1. e4 e5 2. Nf3 Nc6 3. Ke3 *',
      'white',
    )
    expect(error).toBeUndefined()
    expect(drafts.map((line) => line.name).sort()).toEqual(['Scotch', 'Spanish'])
    expect(warnings?.join(' ')).toMatch(/Ke3/)
    expect(readableRows(drafts.find((line) => line.name === 'Scotch')!.pgn, 'white').some((row) => row.comment === 'Scotch')).toBe(true)
  })

  it('reports an illegal variation without dropping the valid line', () => {
    const { drafts, error, warnings } = importPgn('1. e4 c6 2. d4 d5 3. Nc3 dxe4 (3. e5 e4) *', 'black')
    expect(error).toBeUndefined()
    expect(drafts).toHaveLength(1)
    expect(warnings?.join(' ')).toMatch(/e4/)
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
  const classical = {
    id: 'classical',
    name: 'Classical',
    groupName: 'Caro',
    pgn: '1. e4 c6 {Caro} 2. d4 d5 3. Nc3 dxe4 *',
  }
  const exchange = {
    id: 'exchange',
    name: 'Exchange',
    groupName: 'Caro',
    pgn: '1. e4 c6 2. d4 d5 3. exd5 cxd5 *',
  }
  const caro = [classical, exchange]

  it('asks for a shared prefix once, then plays every opponent branch from the fork', () => {
    const steps = createSession(caro, 'black', []).rounds[0]?.steps ?? []
    expect(steps.map((step) => `${step.type}:${step.san}`)).toEqual([
      'opponent:e4',
      'ask:c6',
      'opponent:d4',
      'ask:d5',
      'opponent:Nc3',
      'ask:dxe4',
      'opponent:exd5',
      'ask:cxd5',
    ])
    const fork = fenAfter(['e4', 'c6', 'd4', 'd5'])
    const branched = steps.find((step) => step.san === 'exd5')
    expect(branched?.path).toEqual(['e4', 'c6', 'd4', 'd5'])
    expect(branched?.fenBefore).toBe(fork)
    expect(steps[steps.findIndex((step) => step.san === 'exd5') - 1]?.fenAfter).not.toBe(fork)
    expect(sessionView(createSession(caro, 'black', [])).prompt).toBe('Opponent\u2019s move')
    const ask = untilAsk(createSession(caro, 'black', []), 'c6')
    const view = sessionView(ask)
    expect(view.prompt).toBe('Your move')
    expect(view.interactive).toBe(true)
    expect(view.played).toEqual(['e4'])
    expect(view.prompt).not.toContain('c6')
    expect(view.prompt).not.toContain('Caro')
    expect(view.progress).toEqual({ done: 1, total: 4 })
    const key = positionKey(fenAfter(['e4']))
    for (const introduced of [false, true]) {
      const marked = untilAsk(
        createSession(caro, 'black', [{ positionKey: key, expectedSan: 'c6', introduced, needsReview: false }]),
        'c6',
      )
      expect(currentStep(marked)?.type).toBe('ask')
      expect(sessionView(marked).prompt).toBe('Your move')
    }
  })

  it('plays review branches first, then the preferred move, then the rest in a fixed order', () => {
    expect(trace(caro, 'black').filter((step) => step.startsWith('opponent:'))).toEqual(['opponent:e4', 'opponent:d4', 'opponent:Nc3', 'opponent:exd5'])
    const preferred = withPreferredMove({}, ['e4', 'c6', 'd4', 'd5'], 'exd5')
    expect(branchOrder(trace(caro, 'black', [], preferred))).toEqual(['exd5', 'Nc3'])
    const review = [
      {
        positionKey: positionKey(fenAfter(['e4', 'c6', 'd4', 'd5', 'exd5'])),
        expectedSan: 'cxd5',
        introduced: true,
        needsReview: true,
      },
    ]
    const preferMain = withPreferredMove({}, ['e4', 'c6', 'd4', 'd5'], 'Nc3')
    expect(branchOrder(trace(caro, 'black', review, preferMain))).toEqual(['exd5', 'Nc3'])
  })

  it('reports your own conflicting replies instead of choosing one', () => {
    const same = { id: 'same', name: 'Also classical', groupName: 'Caro', pgn: classical.pgn }
    const knight = { id: 'knight', name: 'Knight', groupName: 'Caro', pgn: '1. e4 c6 2. d4 d5 3. Nc3 Nf6 *' }
    const lines = [classical, same, knight]
    const conflicts = practiceConflicts(lines, 'black')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.options.map((option) => option.san).sort()).toEqual(['Nf6', 'dxe4'])
    const blocked = createSession(lines, 'black', [])
    expect(blocked.phase).toBe('done')
    expect(blocked.rounds).toHaveLength(0)
    const chosen = chooseLearning(
      lines.map((line) => ({ ...line, included: true, yourChoice: false })),
      classical.id,
      true,
      'black',
    )
    const kept = chosen.drafts.filter((line) => line.included)
    expect(kept.map((line) => line.id).sort()).toEqual(['classical', 'same'])
    expect(practiceConflicts(kept, 'black')).toHaveLength(0)
    expect(trace(kept, 'black').filter((step) => step === 'ask:dxe4')).toEqual(['ask:dxe4'])
    expect(trace(kept, 'black').some((step) => step === 'ask:Nf6')).toBe(false)
  })

  it('records the first wrong move immediately and does not clear it after a self-correction', () => {
    const line = { id: 'line-1', name: 'Main line', groupName: 'Lines', pgn: '1. e4 c6 *' }
    const ask = untilAsk(createSession([line], 'black', []), 'c6')
    const wrong = answer(ask, 'e5')
    expect(wrong.events.map((event) => event.type)).toEqual(['miss'])
    expect(wrong.session.phase).toBe('wrong')
    const missed = sessionView(wrong.session)
    expect(missed.prompt).toBe('That\u2019s not the move in this line.')
    expect(missed.prompt).not.toContain('c6')
    expect(missed.fen).toBe(sessionView(ask).fen)
    expect(missed.interactive).toBe(true)
    const again = answer(wrong.session, 'Nf6')
    expect(again.events).toEqual([])
    expect(again.session.phase).toBe('wrong')
    const corrected = answer(wrong.session, 'c6')
    expect(corrected.events).toEqual([])
    expect(corrected.session.phase).toBe('done')
    expect(corrected.session.misses.map((miss) => miss.san)).toEqual(['c6'])
    expect(sessionView(corrected.session).prompt).toBe('c6 still needs attention.')
    const revealed = showMove(wrong.session)
    expect(revealed.events).toEqual([])
    expect(revealed.session.hinted).toBe(true)
    expect(revealed.session.phase).toBe('play')
    expect(sessionView(revealed.session).interactive).toBe(true)
    expect(sessionView(revealed.session).prompt).toBe('Play the marked move.')
    expect(sessionView(revealed.session).prompt).not.toContain('c6')
    expect(sessionView(revealed.session).fen).toBe(sessionView(ask).fen)
    const fresh = answer(untilAsk(createSession([line], 'black', []), 'c6'), 'c6')
    expect(fresh.events.map((event) => event.type)).toEqual(['correct'])
    expect(sessionView(fresh.session).prompt).toBe('Every move matched')
    const shown = showMove(untilAsk(createSession([line], 'black', []), 'c6'))
    expect(shown.events.map((event) => event.type)).toEqual(['miss'])
    expect(shown.session.phase).toBe('play')
    expect(sessionView(shown.session).prompt).not.toContain('c6')
    const hidden = hideMove(shown.session)
    expect(hidden.events).toEqual([])
    expect(hidden.session.hinted).toBe(false)
    expect(hidden.session.misses.map((miss) => miss.san)).toEqual(['c6'])
    expect(sessionView(hidden.session).prompt).toBe('Your move')
    const shownAgain = showMove(hidden.session)
    expect(shownAgain.events).toEqual([])
    expect(shownAgain.session.hinted).toBe(true)
    expect(shownAgain.session.misses).toHaveLength(1)
  })

  it('reviews only the missed position, starting from the move that led there', () => {
    const line = { id: 'line-1', name: 'Main line', groupName: 'Lines', pgn: '1. e4 c6 2. d4 d5 *' }
    let session = answer(untilAsk(createSession([line], 'black', []), 'c6'), 'c6').session
    session = untilAsk(session, 'd5')
    const wrong = answer(session, 'e6')
    const revealed = showMove(wrong.session)
    const continued = answer(revealed.session, 'd5')
    expect(continued.events).toEqual([])
    expect(continued.session.phase).toBe('done')
    expect(sessionView(continued.session).fen).toBe(fenAfter(['e4', 'c6', 'd4', 'd5']))
    expect(sessionView(continued.session).fen).not.toBe(START_FEN)
    const replay = retryMisses(continued.session, 'black')
    expect(replay.scope).toBe('selection')
    expect(replay.rounds[replay.round]?.steps.map((step) => `${step.type}:${step.san}`)).toEqual(['opponent:d4', 'ask:d5'])
    expect(replay.rounds[replay.round]?.steps[0]?.fenBefore).not.toBe(START_FEN)
    const again = retryRound(replay)
    expect(again.rounds[0]?.steps.map((step) => step.san)).toEqual(['d4', 'd5'])
    expect(again.misses).toEqual([])

    const opening = { id: 'white', name: 'Main line', groupName: 'Lines', pgn: '1. e4 *' }
    const missed = answer(showMove(answer(createSession([opening], 'white', []), 'd4').session).session, 'e4')
    const fromSplit = retryMisses(missed.session, 'white')
    expect(fromSplit.rounds[fromSplit.round]?.steps.map((step) => `${step.type}:${step.san}`)).toEqual(['ask:e4'])
    expect(fromSplit.rounds[fromSplit.round]?.steps[0]?.fenBefore).toBe(START_FEN)
  })

  it('keeps a review miss for the next session and does not ask a third time', () => {
    const line = { id: 'line-1', name: 'Main line', groupName: 'Lines', pgn: '1. e4 c6 2. d4 d5 *' }
    let session = answer(untilAsk(createSession([line], 'black', []), 'c6'), 'c6').session
    session = untilAsk(session, 'd5')
    session = answer(showMove(answer(session, 'e6').session).session, 'd5').session
    session = retryMisses(session, 'black')
    session = next(session).session
    expect(sessionView(session).prompt).toBe('Your move')
    expect(sessionView(session).played).not.toContain('d5')
    const wrong = answer(session, 'e6')
    expect(wrong.events.map((event) => event.type)).toEqual(['miss'])
    expect(sessionView(wrong.session).prompt).toBe('That\u2019s not the move in this line.')
    expect(sessionView(wrong.session).prompt).not.toContain('d5')
    const corrected = answer(wrong.session, 'd5')
    expect(corrected.events).toEqual([])
    expect(corrected.session.phase).toBe('done')
    const recap = sessionView(corrected.session)
    expect(recap.prompt).toBe('d5 still needs attention.')
    expect(recap.fen).toBe(fenAfter(['e4', 'c6', 'd4', 'd5']))
    expect(recap.fen).not.toBe(START_FEN)
    const another = retryMisses(corrected.session, 'black')
    expect(another.phase).toBe('play')
    expect(another.rounds[0]?.steps.map((step) => step.san)).toEqual(['d4', 'd5'])
    const sameFive = retryRound(corrected.session)
    expect(sameFive.phase).toBe('play')
    expect(sameFive.misses).toEqual([])
    expect(sameFive.rounds[0]?.steps.map((step) => step.san)).toEqual(['d4', 'd5'])
  })

  it('keeps lines that start from different positions apart', () => {
    const afterE4 = fenAfter(['e4'])
    const late = {
      id: 'late',
      name: 'Late',
      groupName: 'Lines',
      pgn: `[SetUp "1"]\n[FEN "${afterE4}"]\n\n1... c5 *`,
    }
    const queen = { id: 'queen', name: 'Queen pawn', groupName: 'Lines', pgn: '1. d4 d5 *' }
    expect(trace([late, queen], 'black')).toEqual(['ask:c5', 'opponent:d4', 'ask:d5'])
    const review = [
      {
        positionKey: positionKey(fenAfter(['d4'])),
        expectedSan: 'd5',
        introduced: true,
        needsReview: true,
      },
    ]
    expect(trace([late, queen], 'black', review)).toEqual(['opponent:d4', 'ask:d5', 'ask:c5'])
    const steps = createSession([late, queen], 'black', []).rounds[0]?.steps ?? []
    expect(steps.find((step) => step.san === 'c5')?.startFen).toBe(afterE4)
    expect(steps.find((step) => step.san === 'd5')?.startFen).toBe(START_FEN)
  })

  it('can replay every line from the start, or shuffle the repertoire order', () => {
    const fromStart = createSession(caro, 'black', [], {}, { fromStart: true })
    expect(fromStart.rounds[0]?.steps.map((step) => `${step.type}:${step.san}`)).toEqual([
      'opponent:e4',
      'ask:c6',
      'opponent:d4',
      'ask:d5',
      'opponent:Nc3',
      'ask:dxe4',
      'opponent:e4',
      'ask:c6',
      'opponent:d4',
      'ask:d5',
      'opponent:exd5',
      'ask:cxd5',
    ])
    const reversed = createSession(caro, 'black', [], {}, { order: 'random', rng: () => 0 })
    expect(branchOrder((reversed.rounds[0]?.steps ?? []).map((step) => `${step.type}:${step.san}`))).toEqual(['exd5', 'Nc3'])
    const line = { id: 'line-1', name: 'Main line', groupName: 'Lines', pgn: '1. e4 c6 2. d4 d5 *' }
    let session = answer(untilAsk(createSession([line], 'black', []), 'c6'), 'c6').session
    session = answer(untilAsk(session, 'd5'), 'e6').session
    session = answer(session, 'd5').session
    expect(retryMisses(session, 'black', { fromStart: true }).rounds[0]?.steps.map((step) => `${step.type}:${step.san}`)).toEqual([
      'opponent:e4',
      'opponent:c6',
      'opponent:d4',
      'ask:d5',
    ])
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
    expect(d5?.children.map((move) => move.san)).toEqual(['Nc3', 'exd5', 'f3'])
    const classical = d5?.children.find((move) => move.san === 'Nc3')
    const exchange = d5?.children.find((move) => move.san === 'exd5')
    expect(classical?.preferred).toBe(true)
    expect(exchange?.preferred).toBe(false)
    expect(classical?.badge).toBe('Classical')
    expect(classical?.learningCount).toBe(1)
    expect(exchange?.badge).toBe('Exchange')
    expect(exchange?.learningCount).toBe(0)
    expect(classical?.moveLabel).toBe('3. Nc3')
    expect(findMove(tree, ['e4', 'c6'])?.moveLabel).toBe('1... c6')
    expect(pathNotation(tree.fen, ['e4', 'c6', 'd4', 'd5', 'Nc3'])).toBe('1. e4 c6 2. d4 d5 3. Nc3')
  })

  it('lets you prefer a move at one fork without reordering other branches', () => {
    const tree = repertoireOf(lines(), 'black', withPreferredMove({}, ['e4', 'c6', 'd4', 'd5'], 'f3'))
    const d5 = findMove(tree, ['e4', 'c6', 'd4', 'd5'])
    expect(d5?.children.map((move) => move.san)).toEqual(['f3', 'Nc3', 'exd5'])
    expect(d5?.children[0]?.preferred).toBe(true)
    expect(d5?.children[0]?.badge).toBe('Fantasy')
    const classical = findMove(tree, ['e4', 'c6', 'd4', 'd5', 'Nc3'])
    expect(classical?.children.map((move) => move.san)).toEqual(['dxe4'])
    expect(mainPathFrom(tree).slice(0, 6)).toEqual(['e4', 'c6', 'd4', 'd5', 'f3', 'dxe4'])
    expect(pathPrefix(['e4', 'c6'], mainPathFrom(tree))).toBe(true)
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

  it('leaves an existing Caro-Kann line alone after it was renamed, extended, or deleted', () => {
    const catalog = ['repertoire:caro:classical', 'repertoire:caro:exchange']
    expect(retainedSeedIds(catalog, ['repertoire:caro:classical'], [], true, false)).toEqual([])
    expect(retainedSeedIds(catalog, [], ['repertoire:caro:classical'], false, false)).toEqual(['repertoire:caro:exchange'])
    expect(retainedSeedIds(catalog, ['repertoire:caro:classical'], ['repertoire:caro:exchange'], true, true)).toEqual([])
    expect(retainedSeedIds(catalog, [], [], false, false)).toEqual(catalog)
  })
})

describe('repertoire changes', () => {
  const classical = {
    id: 'classical',
    name: 'Classical',
    groupName: 'Classical',
    pgn: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 *',
    included: true,
  }
  const exchange = {
    id: 'exchange',
    name: 'Exchange',
    groupName: 'Exchange',
    pgn: '1. e4 c6 2. d4 d5 3. exd5 cxd5 *',
    included: true,
  }

  it('extends from the original start and reports an exact duplicate', () => {
    const longer = {
      id: 'draft-1',
      name: 'Ng3',
      groupName: 'Lines',
      pgn: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 *',
      included: false,
      yourChoice: false,
    }
    const same = { ...longer, id: 'draft-2', pgn: classical.pgn }
    const mid = {
      ...longer,
      id: 'draft-3',
      pgn: '[SetUp "1"]\n[FEN "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 1 3"]\n\n3... dxe4 *\n',
    }
    const plan = planAdditions([classical, exchange], [longer, same, mid])
    const extend = plan.find((item) => item.kind === 'extend')
    if (!extend) throw new Error('missing extension')
    expect(extend.existingId).toBe('classical')
    expect(extend.pgn).not.toContain('[FEN')
    expect(firstPath(extend.pgn)?.moves.map((move) => move.san)).toEqual(['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3'])
    expect(plan.filter((item) => item.kind === 'duplicate')).toHaveLength(1)
    expect(plan.find((item) => item.kind === 'rejected')?.reason).toMatch(/different position/)
  })

  it('does not let record order choose between your own replies', () => {
    const dxe4 = { ...classical, id: 'dxe4', name: 'Classical', pgn: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 *' }
    const nf6 = { ...classical, id: 'nf6', name: 'Two Knights', pgn: '1. e4 c6 2. d4 d5 3. Nc3 Nf6 *', included: false }
    const shared = { ...classical, id: 'shared', name: 'Also classical', pgn: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 *' }
    const turnedOn = [dxe4, shared, { ...nf6, included: true }]
    const forward = learningImpact(turnedOn, ['nf6'], 'black')
    const reverse = learningImpact([...turnedOn].reverse(), ['nf6'], 'black')
    expect(forward.demoted.map((line) => line.id).sort()).toEqual(['dxe4', 'shared'])
    expect(reverse.demoted.map((line) => line.id).sort()).toEqual(['dxe4', 'shared'])
    const both = learningImpact(
      [
        { ...dxe4, included: true },
        { ...nf6, included: true },
      ],
      ['dxe4', 'nf6'],
      'black',
    )
    expect(both.demoted).toEqual([])
    expect(both.conflicts[0]?.choices.map((choice) => choice.san).sort()).toEqual(['Nf6', 'dxe4'])
    const swapped = learningImpact(
      [
        { ...nf6, included: true },
        { ...dxe4, included: true },
      ],
      ['nf6', 'dxe4'],
      'black',
    )
    expect(swapped.conflicts[0]?.choices.map((choice) => choice.san).sort()).toEqual(['Nf6', 'dxe4'])
  })

  it('catches the same position reached by a different move order', () => {
    const queen = {
      id: 'queen',
      name: 'Queen pawn',
      groupName: 'Lines',
      pgn: '1. d4 d5 2. c4 e6 *',
      included: true,
    }
    const english = {
      id: 'english',
      name: 'English',
      groupName: 'Lines',
      pgn: '1. c4 d5 2. d4 c6 *',
      included: true,
    }
    const impact = learningImpact([queen, english], ['queen'], 'black')
    expect(impact.demoted.map((line) => line.id)).toEqual(['english'])
  })

  it('shows when deleting one variation also edits another branch in the same PGN', () => {
    const combined = {
      id: 'both',
      name: 'Caro notes',
      groupName: 'Lines',
      pgn: '1. e4 c6 2. d4 d5 3. Nc3 (3. exd5 cxd5) dxe4 *',
      included: true,
    }
    const plan = planBranchRemoval([combined, exchange], ['e4', 'c6', 'd4', 'd5', 'Nc3'], { 'e4|c6|d4|d5': 'Nc3' }, '3. Nc3')
    expect(plan.deleted.map((line) => line.name)).toEqual([])
    expect(plan.shortened.map((line) => line.name)).toEqual(['Caro notes'])
    expect(plan.shortened[0]?.kept).toBe('exd5')
    expect(plan.deleted).not.toContainEqual(expect.objectContaining({ id: 'exchange' }))
    expect(allPaths(plan.updates[0]?.pgn ?? '').map((path) => path.moves.map((move) => move.san))).toEqual([
      ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'],
    ])
    expect(plan.prefs['e4|c6|d4|d5']).toBeUndefined()
    const tree = repertoireOf([exchange], 'black')
    expect(nearestPath(tree, ['e4', 'c6', 'd4', 'd5', 'Nc3'])).toEqual(['e4', 'c6', 'd4', 'd5'])
  })

  it('keeps every variation of a saved line available to practice', () => {
    const line = {
      id: 'both',
      name: 'Caro notes',
      groupName: 'Lines',
      pgn: '1. e4 c6 2. d4 d5 3. Nc3 (3. exd5 cxd5) dxe4 *',
    }
    const variations = variationLines(line)
    expect(variations).toHaveLength(2)
    expect(variations.every((item) => item.id === 'both')).toBe(true)
    expect(variations.map((item) => firstPath(item.pgn)?.moves.at(-1)?.san).sort()).toEqual(['cxd5', 'dxe4'])
  })
})

function fenAfter(moves: string[]): string {
  let fen = START_FEN
  for (const san of moves) {
    const applied = applySan(fen, san)
    if (!applied) throw new Error(san)
    fen = applied.fen
  }
  return fen
}

function untilAsk(session: ReturnType<typeof createSession>, san: string) {
  let current = session
  while (current.phase === 'play') {
    const step = currentStep(current)
    if (!step) break
    if (step.type === 'ask') {
      if (step.san !== san) throw new Error(`asked ${step.san}`)
      return current
    }
    current = next(current).session
  }
  throw new Error(`missing ask ${san}`)
}

function trace(
  lines: { id: string; name: string; groupName: string; pgn: string }[],
  color: 'white' | 'black',
  progress: { positionKey: string; expectedSan: string; introduced: boolean; needsReview: boolean }[] = [],
  prefs: ReturnType<typeof withPreferredMove> = {},
): string[] {
  let session = createSession(lines, color, progress, prefs)
  const played: string[] = []
  while (session.phase === 'play') {
    const step = currentStep(session)
    if (!step) break
    played.push(`${step.type}:${step.san}`)
    session = step.type === 'opponent' ? next(session).session : answer(session, step.san).session
  }
  return played
}

function branchOrder(played: string[]): string[] {
  return played.filter((step) => step === 'opponent:Nc3' || step === 'opponent:exd5').map((step) => step.slice('opponent:'.length))
}
