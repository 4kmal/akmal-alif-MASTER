import { mediaIdFromEvent, serveBlogSource } from '../../../../../services/blog-studio'

export default eventHandler(async (event) => {
  await serveBlogSource(event, mediaIdFromEvent(event))
  return null
})
