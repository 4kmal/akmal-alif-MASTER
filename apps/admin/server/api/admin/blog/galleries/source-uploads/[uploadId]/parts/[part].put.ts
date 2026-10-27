import { getRouterParam } from 'h3'
import { gallerySourceUploadIdFromEvent, putBlogGallerySourcePart } from '../../../../../../../services/blog-studio'

export default eventHandler(event => putBlogGallerySourcePart(event, gallerySourceUploadIdFromEvent(event), Number(getRouterParam(event, 'part'))))
