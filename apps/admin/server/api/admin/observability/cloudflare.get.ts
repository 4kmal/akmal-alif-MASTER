import { readCloudflareReport } from '../../../services/cloudflare-observability'

export default eventHandler(event => readCloudflareReport(event))
