import { postIdFromEvent, updateBlogDraft } from '../../../../../services/blog-studio'

export default eventHandler(event => updateBlogDraft(event, postIdFromEvent(event)))
