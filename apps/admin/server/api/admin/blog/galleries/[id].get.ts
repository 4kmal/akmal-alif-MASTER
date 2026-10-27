import { galleryIdFromEvent, getBlogGallery } from '../../../../services/blog-studio'

export default eventHandler(event => getBlogGallery(event, galleryIdFromEvent(event)))
