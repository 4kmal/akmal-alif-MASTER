import { addBlogGalleryPage, galleryIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => addBlogGalleryPage(event, galleryIdFromEvent(event)))
