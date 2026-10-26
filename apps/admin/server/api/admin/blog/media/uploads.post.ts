import { initBlogUpload } from '../../../../services/blog-studio'

export default eventHandler(event => initBlogUpload(event))
