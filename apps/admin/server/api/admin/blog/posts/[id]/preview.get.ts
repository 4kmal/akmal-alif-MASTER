import { postIdFromEvent, previewBlogPost } from '../../../../../services/blog-studio'

export default eventHandler(event => previewBlogPost(event, postIdFromEvent(event)))
