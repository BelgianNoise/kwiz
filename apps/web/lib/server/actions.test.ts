import { describe, expect, it } from 'vitest'

import { matchRoute, ROUTES } from './actions'

/**
 * **The catalogue, checked against the spec rather than against itself.**
 *
 * The list below is transcribed from protocol §7.1–§7.2, independently of the table in
 * `actions.ts`. That is the whole point: an endpoint quietly dropped, renamed, or never written
 * would otherwise be invisible — there is no client yet to notice, and every other test only
 * exercises the actions it happens to call.
 */
const SPEC_PATHS = [
  // §7.1 player — `join` is not here: it has no `gameId`, so it is its own route.
  'switch-team',
  'draft',
  'submit',
  'buzz',
  // §7.2 master
  'start',
  'finish',
  'abandon',
  'rounds/:roundId/open',
  'rounds/:roundId/close',
  'questions/:questionId/open',
  'questions/:questionId/lock',
  'questions/:questionId/reveal',
  'questions/:questionId/score',
  'buzzes/:buzzId/adjudicate',
  'questions/:questionId/reopen-buzzers',
  'answers/validate',
  'answers/spotlight',
  'questions/:questionId/do-winners',
  'questions/:questionId/do-scores',
  'questions/:questionId/skip',
  'answers/submit-for-team',
  'scoreboard',
  'break',
  'break/end',
  'picker',
  'finale/config',
  'finale/finalists',
  'finale/turn/start',
  'finale/turn/pass',
  'finale/keywords/:keywordId/mark',
  'finale/keywords/:keywordId/unmark',
  'finale/reveal',
  'finale/eliminate',
  'adjust-score',
  'adjustments/:adjustmentId/revoke',
  'regenerate-code',
  'resync',
  // PRD 2 §11.2 and §13.4 — added to the spec in slice 4, when it turned out `TEAM_ADDED` and
  // `TEAM_UPDATED` existed as events with no action that could cause them.
  'teams',
  'teams/:teamId',
  // §12.1 — the cascade was in data model §10 and the menu item in the PRD, with no action between.
  'delete',
]

describe('the action catalogue', () => {
  it('is exactly protocol §7.1–§7.2, with nothing missing and nothing invented', () => {
    const implemented = ROUTES.map((route) => route.pattern.join('/'))

    expect([...implemented].sort()).toEqual([...SPEC_PATHS].sort())
    // 40 here plus `POST /api/games/join`, which is the 41 the spec lists.
    expect(implemented).toHaveLength(40)
  })

  it('requires a device token on exactly the four player actions', () => {
    const players = ROUTES.filter((route) => route.audience === 'PLAYER').map(
      (r) => r.name,
    )
    // Identity, not authorisation (PRD 1 §4) — but a master action asking for a token, or a player
    // action not asking, would both be wrong in ways nothing else here would catch.
    expect(players).toEqual(['switch-team', 'draft', 'submit', 'buzz'])
  })
})

describe('matching a path', () => {
  it('extracts the ids the spec puts in the path', () => {
    expect(matchRoute(['questions', 'q-1', 'lock'])).toMatchObject({
      route: { name: 'question-lock' },
      params: { questionId: 'q-1' },
    })
    expect(matchRoute(['finale', 'keywords', 'kw-3', 'mark'])?.params).toEqual({
      keywordId: 'kw-3',
    })
  })

  it('tells `break` from `break/end`, which differ only in length', () => {
    expect(matchRoute(['break'])?.route.name).toBe('break')
    expect(matchRoute(['break', 'end'])?.route.name).toBe('break-end')
  })

  it('matches nothing it was not given', () => {
    expect(matchRoute(['questions', 'q-1'])).toBeUndefined()
    expect(matchRoute(['questions', 'q-1', 'destroy'])).toBeUndefined()
    expect(matchRoute([])).toBeUndefined()
    // A literal segment must match literally, or `/rounds/x/open` and `/rounds/open/x` would be
    // the same request.
    expect(matchRoute(['rounds', 'open', 'r-1'])).toBeUndefined()
  })
})
