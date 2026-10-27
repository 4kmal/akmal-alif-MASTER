import { galleryIdFromEvent, initBlogGallerySource } from '../../../../../services/blog-studio'

export default eventHandler(event => initBlogGallerySource(event, galleryIdFromEvent(event)))
