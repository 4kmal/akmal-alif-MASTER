import { describe, expect, it } from 'vitest'
import { validateAiDraft } from '../server/utils/judging-ai'

const evidence = [
  {
    id: 'source-1',
    teamId: '01-console',
    path: 'src/main.ts',
    kind: 'source',
    text: 'first line\nsecond line\nthird line',
    lines: 3,
    sha256: 'a'.repeat(64),
    snapshotSha: 'b'.repeat(40),
    createdAt: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'brief-1',
    teamId: '01-console',
    path: 'README.pdf',
    kind: 'document',
    text: 'A documented feature.',
    lines: 1,
    pages: [{ page: 1, text: 'A documented feature.' }],
    sha256: 'c'.repeat(64),
    snapshotSha: 'd'.repeat(40),
    createdAt: '2026-10-28T00:00:00.000Z',
  },
]

describe('judging AI draft validation', () => {
  it('keeps only evidence-linked draft fields and validates line/page locators', () => {
    const draft = validateAiDraft({
      strengths: [{ text: 'The source contains the requested behavior.', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 2 }] }],
      concerns: [{ text: 'The brief leaves one edge case unclear.', citations: [{ evidenceId: 'brief-1', page: 1 }] }],
      features: [{ feature: 'Feature 1', status: 'present', citations: [{ evidenceId: 'source-1', line: 3 }] }],
      proposedScores: [{ criterion: 'implementation', score: 80, citations: [{ evidenceId: 'source-1', line: 2 }] }],
      automaticReview: 'ignore this field',
    }, evidence)

    expect(draft).toEqual({
      strengths: [{ text: 'The source contains the requested behavior.', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 2 }] }],
      concerns: [{ text: 'The brief leaves one edge case unclear.', citations: [{ evidenceId: 'brief-1', page: 1 }] }],
      features: [{ feature: 'Feature 1', status: 'present', note: undefined, citations: [{ evidenceId: 'source-1', lineStart: 3, lineEnd: 3 }] }],
      proposedScores: [{ criterion: 'implementation', score: 80, citations: [{ evidenceId: 'source-1', lineStart: 2, lineEnd: 2 }] }],
      citations: [],
    })
    expect(draft).not.toHaveProperty('automaticReview')
  })

  it('rejects fabricated evidence locations and absent citations', () => {
    expect(() => validateAiDraft({ strengths: [{ text: 'claim', citations: [{ evidenceId: 'missing', line: 1 }] }] }, evidence)).toThrow(/missing evidence/)
    expect(() => validateAiDraft({ strengths: [{ text: 'claim', citations: [{ evidenceId: 'source-1', line: 99 }] }] }, evidence)).toThrow(/unavailable lines/)
    expect(() => validateAiDraft({ concerns: [{ text: 'claim', citations: [] }] }, evidence)).toThrow(/citations/)
  })

  it('rejects claims that a video or demo was watched', () => {
    expect(() => validateAiDraft({ strengths: [{ text: 'I watched the demo video.', citations: [{ evidenceId: 'source-1', line: 1 }] }] }, evidence)).toThrow(/must not claim/)
  })
})
