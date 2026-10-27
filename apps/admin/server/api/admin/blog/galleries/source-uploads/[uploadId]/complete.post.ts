import { completeBlogGallerySourceUpload, gallerySourceUploadIdFromEvent } from '../../../../../../services/blog-studio'

export default eventHandler(event => completeBlogGallerySourceUpload(event, gallerySourceUploadIdFromEvent(event)))
