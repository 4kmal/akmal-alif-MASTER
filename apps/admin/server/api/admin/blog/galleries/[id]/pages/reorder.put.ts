import { galleryIdFromEvent, reorderBlogGalleryPages } from '../../../../../../services/blog-studio'

export default eventHandler(event => reorderBlogGalleryPages(event, galleryIdFromEvent(event)))
