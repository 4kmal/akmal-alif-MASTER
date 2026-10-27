import { galleryIdFromEvent, updateBlogGallery } from '../../../../services/blog-studio'

export default eventHandler(event => updateBlogGallery(event, galleryIdFromEvent(event)))
