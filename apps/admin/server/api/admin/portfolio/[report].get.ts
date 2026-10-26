import { createError } from 'h3'
import { handlePortfolioReport } from '../../../services/portfolio-analytics'

const REPORTS = new Set(['traffic', 'content', 'engagement', 'conversions', 'realtime', 'performance', 'goals', 'history'])

export default eventHandler((event) => {
  const report = getRouterParam(event, 'report') || ''
  if (!REPORTS.has(report))
    throw createError({ status: 404, statusText: 'Portfolio report not found' })
  return handlePortfolioReport(event, report)
})
