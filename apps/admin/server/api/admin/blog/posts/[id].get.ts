import { getBlogPost, postIdFromEvent } from '../../../../services/blog-studio'

export default eventHandler(event => getBlogPost(event, postIdFromEvent(event)))
