import { gallerySourceUploadIdFromEvent, getBlogGallerySourceUpload } from '../../../../../services/blog-studio'

export default eventHandler(event => getBlogGallerySourceUpload(event, gallerySourceUploadIdFromEvent(event)))
