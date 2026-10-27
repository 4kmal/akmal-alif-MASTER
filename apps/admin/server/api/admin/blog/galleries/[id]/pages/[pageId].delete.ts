import { deleteBlogGalleryPage, galleryIdFromEvent, galleryPageIdFromEvent } from '../../../../../../services/blog-studio'

export default eventHandler(event => deleteBlogGalleryPage(event, galleryIdFromEvent(event), galleryPageIdFromEvent(event)))
