export const JUDGING_EVENT_ID = 'sdc-2026'

export const JUDGING_TEAM_IDS = [
  '01-console',
  '02-ctrl-ai',
  '03-ctrl-cv',
  '04-ctrl-alt-three',
  '05-ctrl-s',
  '06-decisive',
  '07-dovun',
  '08-dsaise',
  '09-duologic',
] as const

export const JUDGING_REPO_CHECKS = [
  'Yes',
  'No – private/broken',
  'No – doesn\'t match demo',
] as const

export interface JudgingModel {
  ASSIGNMENT?: unknown
  validateRecord?: (key: string, data: unknown) => unknown | Promise<unknown>
  calculateReviews?: (reviews: unknown) => unknown
  readiness?: (...args: unknown[]) => unknown | Promise<unknown>
}

export interface JudgingFallbackModel extends JudgingModel {
  ASSIGNMENT: {
    id: string
    eventId: string
    teams: { id: string }[]
  }
}

const fallbackModel: JudgingFallbackModel = {
  ASSIGNMENT: {
    id: JUDGING_EVENT_ID,
    eventId: JUDGING_EVENT_ID,
    teams: JUDGING_TEAM_IDS.map(id => ({ id })),
  },
}

let modelPromise: Promise<JudgingModel> | undefined

export async function loadJudgingModel(): Promise<JudgingModel> {
  // The shared model is supplied by the judging UI package at integration time.
  // @ts-expect-error The isolated backend worktree intentionally does not carry that package.
  modelPromise ??= import('../../shared/judging/model.mjs').then(module => module as JudgingModel).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/cannot find module|module not found|failed to resolve/i.test(message))
      return fallbackModel
    throw error
  })
  return modelPromise
}

export async function judgingAssignment(): Promise<unknown> {
  const model = await loadJudgingModel()
  return model.ASSIGNMENT ?? fallbackModel.ASSIGNMENT
}

export async function judgingTeamIds(): Promise<string[]> {
  const assignment = await judgingAssignment()
  if (assignment && typeof assignment === 'object') {
    const value = assignment as { teamIds?: unknown, teams?: unknown }
    if (Array.isArray(value.teamIds)) {
      const ids = value.teamIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length)
        return ids
    }
    if (Array.isArray(value.teams)) {
      const ids = value.teams.map((team) => {
        if (typeof team === 'string')
          return team
        if (team && typeof team === 'object' && typeof (team as { id?: unknown }).id === 'string')
          return (team as { id: string }).id
        return ''
      }).filter(Boolean)
      if (ids.length)
        return ids
    }
  }
  return [...JUDGING_TEAM_IDS]
}
