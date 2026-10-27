import { abortBlogGallerySourceUpload, gallerySourceUploadIdFromEvent } from '../../../../../services/blog-studio'

export default eventHandler(event => abortBlogGallerySourceUpload(event, gallerySourceUploadIdFromEvent(event)))
