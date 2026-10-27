import { galleryIdFromEvent, galleryRevisionFromEvent, getBlogGalleryRevision } from '../../../../../../services/blog-studio'

export default eventHandler(event => getBlogGalleryRevision(event, galleryIdFromEvent(event), galleryRevisionFromEvent(event)))
