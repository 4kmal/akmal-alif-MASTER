import { listBlogPosts } from '../../../../services/blog-studio'

export default eventHandler(event => listBlogPosts(event))
