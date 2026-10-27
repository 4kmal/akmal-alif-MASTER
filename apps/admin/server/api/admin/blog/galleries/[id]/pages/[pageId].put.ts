import { galleryIdFromEvent, galleryPageIdFromEvent, updateBlogGalleryPage } from '../../../../../../services/blog-studio'

export default eventHandler(event => updateBlogGalleryPage(event, galleryIdFromEvent(event), galleryPageIdFromEvent(event)))
