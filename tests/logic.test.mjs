// Automatic checks (2026-11-05). Run them with:  npm test
// They check the logic that decides marks and feedback, so a later change
// can't quietly break it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandFromPct, overallBand } from '../src/lib/bands.js'
import { frameStem, makeGaps, saidPhrase, targets } from '../src/lib/textMatch.js'

test('page percentage → band (as if out of 40)', () => {
  assert.equal(bandFromPct(100), 9)
  assert.equal(bandFromPct(75), 7) // 30/40
  assert.equal(bandFromPct(60), 6) // 24/40
  assert.equal(bandFromPct(10), 3.5)
})

test('overall band rounds like IELTS', () => {
  assert.equal(overallBand([6.5, 6.5, 5, 7]), 6.5) // 6.25 → 6.5
  assert.equal(overallBand([6, 6, 6, 6.5]), 6) // 6.125 → 6
  assert.equal(overallBand([7, 7, 7, 8]), 7.5) // 7.25 → 7.5
  assert.equal(overallBand([6.5, 7, 7, 7]), 7) // 6.875 → 7
  assert.equal(overallBand([7, null, null, null]), null) // needs two skills
})

test('phrases a student used are found in what they said', () => {
  const said = "I'm majoring in finance and I do some tutoring, which helps me get hands on experience"
  assert.equal(saidPhrase(said, 'tutoring'), true)
  assert.equal(saidPhrase(said, 'hands-on experience'), true)
  assert.equal(saidPhrase(said, 'make pocket money'), false)
  assert.equal(saidPhrase(said, 'take someone’s breath away'), false)
})

test('grammar "Try it" frames give a phrase to look for', () => {
  assert.equal(frameStem('I’m majoring in ______.'), "i'm majoring in")
  assert.equal(frameStem('…, which helps me ______.'), 'which helps me')
  assert.equal(frameStem('It’s ______ between ______.'), '')
})

test('Get ready: targets and gap-fills from a model answer', () => {
  const q = {
    model: {
      answer: 'It’s nestled between two mountain ranges, so the scenery is stunning, and I’ve always felt a strong sense of belonging there.',
      phrases: [['nestled', 'in a sheltered place'], ['stunning', 'very beautiful'], ['a sense of belonging', 'feeling part of a place']],
      grammar: [{ pattern: 'come from + place', try: 'I come from ______.' }],
    },
  }
  assert.equal(targets(q).length, 4)
  const gaps = makeGaps(q)
  assert.equal(gaps.length, 3)
  assert.deepEqual(gaps.map((g) => g.answer), ['nestled', 'stunning', 'sense'])
  assert.ok(gaps.every((g) => !`${g.before}${g.after}`.includes(`${g.answer} `) || g.before.length > 0))
})
