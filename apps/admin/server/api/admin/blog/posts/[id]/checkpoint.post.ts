import { checkpointBlogPost, postIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => checkpointBlogPost(event, postIdFromEvent(event)))
