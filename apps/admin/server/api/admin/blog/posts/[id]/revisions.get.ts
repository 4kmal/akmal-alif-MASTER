import { listBlogRevisions, postIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => listBlogRevisions(event, postIdFromEvent(event)))
