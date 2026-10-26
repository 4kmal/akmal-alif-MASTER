import { postIdFromEvent, restoreBlogPost } from '../../../../../services/blog-studio'

export default eventHandler(event => restoreBlogPost(event, postIdFromEvent(event)))
