import { readGamingSessionDetail } from '../../../../../services/gaming-observability'

export default eventHandler(event => readGamingSessionDetail(event))
