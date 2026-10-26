import { postIdFromEvent, publishBlogPost } from '../../../../../services/blog-studio'

export default eventHandler(event => publishBlogPost(event, postIdFromEvent(event)))
