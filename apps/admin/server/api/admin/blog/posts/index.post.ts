import { createBlogPost, parseJsonBody } from '../../../../services/blog-studio'

export default eventHandler(async (event) => {
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const result = await createBlogPost(event, body)
  setResponseStatus(event, 201)
  return result
})
