import { mediaIdFromEvent, serveBlogSource } from '../../../../../services/blog-studio'

export default eventHandler(async (event) => {
  const body = await serveBlogSource(event, mediaIdFromEvent(event))
  return body
})
