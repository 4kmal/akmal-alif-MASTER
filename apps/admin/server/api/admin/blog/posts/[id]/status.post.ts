import { postIdFromEvent, setBlogPostStatus } from '../../../../../services/blog-studio'

export default eventHandler(event => setBlogPostStatus(event, postIdFromEvent(event)))
