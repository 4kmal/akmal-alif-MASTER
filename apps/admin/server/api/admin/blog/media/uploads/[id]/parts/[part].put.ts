import { putBlogUploadPart, uploadIdFromEvent } from '../../../../../../../services/blog-studio'

export default eventHandler((event) => {
  const part = Number(getRouterParam(event, 'part'))
  return putBlogUploadPart(event, uploadIdFromEvent(event), part)
})
