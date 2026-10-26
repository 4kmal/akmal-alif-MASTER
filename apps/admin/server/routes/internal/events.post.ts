import { ingestPortfolioEvents } from '../../services/portfolio-analytics'
import { getRuntimeString } from '../../utils/runtime-config'

export default eventHandler(async (event) => {
  const expectedGatewayToken = getRuntimeString(event, 'portfolioGatewayToken', 'PORTFOLIO_GATEWAY_TOKEN')
  if (!expectedGatewayToken || getHeader(event, 'x-portfolio-gateway') !== expectedGatewayToken) {
    throw createError({ status: 401, statusText: 'Analytics gateway authentication failed' })
  }

  const requestUrl = getRequestURL(event)
  const adminOrigin = getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN')
  if (requestUrl.origin !== adminOrigin) {
    throw createError({ status: 403, statusText: 'Analytics ingestion is restricted to the portfolio origin' })
  }

  if (!getHeader(event, 'x-portfolio-meta')) {
    throw createError({ status: 400, statusText: 'Trusted analytics metadata is required' })
  }

  return ingestPortfolioEvents(event)
})
