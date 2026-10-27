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
      strengths: [{ text: 'The source contains the requested behavior.', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 2, evidenceKind: 'code-evidence' }] }],
      concerns: [{ text: 'The brief leaves one edge case unclear.', citations: [{ evidenceId: 'brief-1', page: 1, evidenceKind: 'document' }] }],
      features: [
        { feature: 'profiles', proposal: 'present', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 3 }] },
        { feature: 'trends', proposal: 'unverified', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 1 }] },
        { feature: 'matching', proposal: 'unverified', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 1 }] },
        { feature: 'reskilling', proposal: 'unverified', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 1 }] },
        { feature: 'sdg', proposal: 'unverified', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 1 }] },
        { feature: 'scenarios', proposal: 'unverified', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 1 }] },
      ],
      scores: [{ criterion: 'innovation', score: 80, citations: [{ evidenceId: 'source-1', line: 2 }] }],
      automaticReview: 'ignore this field',
    }, evidence)

    expect(draft).toEqual({
      strengths: [{ text: 'The source contains the requested behavior.', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 2, evidenceKind: 'code-evidence' }] }],
      concerns: [{ text: 'The brief leaves one edge case unclear.', citations: [{ evidenceId: 'brief-1', page: 1, evidenceKind: 'document' }] }],
      features: [
        { feature: 'profiles', proposal: 'present', demo: 'unverified', note: '', citations: [{ evidenceId: 'source-1', lineStart: 3, lineEnd: 3, evidenceKind: 'code-evidence' }] },
        { feature: 'trends', proposal: 'unverified', demo: 'unverified', note: '', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 1, evidenceKind: 'code-evidence' }] },
        { feature: 'matching', proposal: 'unverified', demo: 'unverified', note: '', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 1, evidenceKind: 'code-evidence' }] },
        { feature: 'reskilling', proposal: 'unverified', demo: 'unverified', note: '', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 1, evidenceKind: 'code-evidence' }] },
        { feature: 'sdg', proposal: 'unverified', demo: 'unverified', note: '', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 1, evidenceKind: 'code-evidence' }] },
        { feature: 'scenarios', proposal: 'unverified', demo: 'unverified', note: '', citations: [{ evidenceId: 'source-1', lineStart: 1, lineEnd: 1, evidenceKind: 'code-evidence' }] },
      ],
      scores: [
        { criterion: 'innovation', score: 80, citations: [{ evidenceId: 'source-1', lineStart: 2, lineEnd: 2, evidenceKind: 'code-evidence' }] },
        { criterion: 'problemSolutionFit', score: null, citations: [] },
        { criterion: 'feasibility', score: null, citations: [] },
        { criterion: 'clarity', score: null, citations: [] },
      ],
      citations: [],
    })
    expect(draft).not.toHaveProperty('automaticReview')
  })

  it('allows unsupported criterion scores without citations and labels Markdown source as participant claim', () => {
    const markdownEvidence = {
      id: 'readme-1',
      teamId: '01-console',
      path: 'README.md',
      kind: 'source',
      text: 'The proposal describes the feature.',
      lines: 1,
      sha256: 'e'.repeat(64),
      snapshotSha: 'f'.repeat(40),
      createdAt: '2026-10-28T00:00:00.000Z',
    }
    const draft = validateAiDraft({
      strengths: [{ text: 'The proposal describes the feature.', citations: [{ evidenceId: 'readme-1', line: 1 }] }],
      features: ['profiles', 'trends', 'matching', 'reskilling', 'sdg', 'scenarios'].map(feature => ({
        feature,
        proposal: 'unverified',
        demo: 'unverified',
        citations: [{ evidenceId: 'readme-1', line: 1 }],
      })),
      scores: [
        { criterion: 'innovation', score: null },
        { criterion: 'problemSolutionFit', score: null, citations: [] },
        { criterion: 'feasibility', score: null },
        { criterion: 'clarity', score: null },
      ],
    }, [markdownEvidence])

    expect(draft.scores).toEqual([
      { criterion: 'innovation', score: null, citations: [] },
      { criterion: 'problemSolutionFit', score: null, citations: [] },
      { criterion: 'feasibility', score: null, citations: [] },
      { criterion: 'clarity', score: null, citations: [] },
    ])
    expect(draft.strengths).toEqual([{ text: 'The proposal describes the feature.', citations: [{ evidenceId: 'readme-1', lineStart: 1, lineEnd: 1, evidenceKind: 'participant-claim' }] }])
  })

  it('rejects fabricated evidence locations and absent citations', () => {
    expect(() => validateAiDraft({ strengths: [{ text: 'claim', citations: [{ evidenceId: 'missing', line: 1 }] }] }, evidence)).toThrow(/missing evidence/)
    expect(() => validateAiDraft({ strengths: [{ text: 'claim', citations: [{ evidenceId: 'source-1', line: 99 }] }] }, evidence)).toThrow(/unavailable lines/)
    expect(() => validateAiDraft({ concerns: [{ text: 'claim', citations: [] }] }, evidence)).toThrow(/citations/)
  })

  it('rejects claims that a video or demo was watched', () => {
    expect(() => validateAiDraft({ strengths: [{ text: 'I watched the demo video.', citations: [{ evidenceId: 'source-1', line: 1 }] }] }, evidence)).toThrow(/must not claim/)
  })

  it('allows an explicit statement that the demo was not watched', () => {
    expect(() => validateAiDraft({
      strengths: [{ text: 'I did not watch the demo video.', citations: [{ evidenceId: 'source-1', line: 1 }] }],
      features: ['profiles', 'trends', 'matching', 'reskilling', 'sdg', 'scenarios'].map(feature => ({ feature, proposal: 'unverified', demo: 'unverified', citations: [{ evidenceId: 'source-1', line: 1 }] })),
    }, evidence)).not.toThrow()
  })
})
