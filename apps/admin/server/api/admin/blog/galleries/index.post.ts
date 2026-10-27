import { createBlogGallery } from '../../../../services/blog-studio'

export default eventHandler(event => createBlogGallery(event))
