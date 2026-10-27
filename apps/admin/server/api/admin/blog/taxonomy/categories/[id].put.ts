import { categoryIdFromEvent, updateBlogCategory } from '../../../../../services/blog-studio'

export default eventHandler(event => updateBlogCategory(event, categoryIdFromEvent(event)))
