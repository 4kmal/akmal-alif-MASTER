import { abortBlogUpload, uploadIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => abortBlogUpload(event, uploadIdFromEvent(event)))
