import { listBlogGalleries } from '../../../../services/blog-studio'

export default eventHandler(event => listBlogGalleries(event))
