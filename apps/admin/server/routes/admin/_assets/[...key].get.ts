import { serveImageAsset } from '../../../utils/image-asset'

export default eventHandler(event => serveImageAsset(event))
