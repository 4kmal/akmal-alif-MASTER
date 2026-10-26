import { listBlogMedia } from '../../../services/blog-studio'

export default eventHandler(event => listBlogMedia(event))
