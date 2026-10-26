import { handlePortfolioReport } from '../../services/portfolio-analytics'

export default eventHandler(event => handlePortfolioReport(event, 'overview'))
