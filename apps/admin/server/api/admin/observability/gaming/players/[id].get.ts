import { readGamingPlayerDetail } from '../../../../../services/gaming-observability'

export default eventHandler(event => readGamingPlayerDetail(event))
