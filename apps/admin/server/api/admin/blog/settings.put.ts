import { updateBlogSettings } from '../../../services/blog-studio'

export default eventHandler(event => updateBlogSettings(event))
