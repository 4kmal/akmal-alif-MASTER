import { galleryIdFromEvent, reopenBlogGalleryDraft } from '../../../../../services/blog-studio'

export default eventHandler(event => reopenBlogGalleryDraft(event, galleryIdFromEvent(event)))
