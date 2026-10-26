import { getBlogUpload, uploadIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => getBlogUpload(event, uploadIdFromEvent(event)))
