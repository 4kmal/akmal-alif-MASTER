import { galleryIdFromEvent, serveBlogGallerySource } from '../../../../../services/blog-studio'

export default eventHandler(event => serveBlogGallerySource(event, galleryIdFromEvent(event)))
