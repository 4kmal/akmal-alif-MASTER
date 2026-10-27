import { deleteBlogGallery, galleryIdFromEvent } from '../../../../services/blog-studio'

export default eventHandler(event => deleteBlogGallery(event, galleryIdFromEvent(event)))
