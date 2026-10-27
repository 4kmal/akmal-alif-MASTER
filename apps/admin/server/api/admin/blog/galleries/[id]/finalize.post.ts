import { finalizeBlogGallery, galleryIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => finalizeBlogGallery(event, galleryIdFromEvent(event)))
