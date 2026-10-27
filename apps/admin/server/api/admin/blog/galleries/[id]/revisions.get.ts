import { galleryIdFromEvent, listBlogGalleryRevisions } from '../../../../../services/blog-studio'

export default eventHandler(event => listBlogGalleryRevisions(event, galleryIdFromEvent(event)))
