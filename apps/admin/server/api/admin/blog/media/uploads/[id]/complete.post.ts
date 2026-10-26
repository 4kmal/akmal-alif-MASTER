import { completeBlogUpload, uploadIdFromEvent } from '../../../../../../services/blog-studio'

export default eventHandler(event => completeBlogUpload(event, uploadIdFromEvent(event)))
