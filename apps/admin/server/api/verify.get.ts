import { getRuntimeString } from '../utils/runtime-config'

defineRouteMeta({
  openAPI: {
    description: 'Verify the current authentication method',
    responses: {
      200: {
        description: 'The authentication credentials are valid',
      },
      default: {
        description: 'The authentication credentials are invalid',
      },
    },
  },
})

export default eventHandler((event) => {
  const authMethod: unknown = event.context.authMethod
  const userID: unknown = event.context.userID
  const userEmail: unknown = event.context.userEmail
  if (
    (
      authMethod !== 'site-token'
      && authMethod !== 'access-user'
      && authMethod !== 'access-service'
      && authMethod !== 'portfolio-gateway'
      && authMethod !== 'local-admin'
    )
    || typeof userID !== 'string'
    || !userID
    || typeof userEmail !== 'string'
    || !userEmail
  ) {
    throw createError({
      status: 401,
      statusText: 'Unauthorized',
    })
  }

  const cfAccessTeamDomain = getRuntimeString(event, 'cfAccessTeamDomain', 'CF_ACCESS_TEAM_DOMAIN')
  const cfAccessAud = getRuntimeString(event, 'cfAccessAud', 'CF_ACCESS_AUD')

  return {
    name: 'Akmal Alif / Admin',
    url: getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN'),
    authMethod,
    userID,
    userEmail,
    accessEnabled: isCloudflareAccessConfigured(cfAccessTeamDomain, cfAccessAud),
  }
})
