import { getBlogSettings } from '../../../services/blog-studio'

export default eventHandler(event => getBlogSettings(event))
