import { createBlogTaxonomy } from '../../../services/blog-studio'

export default eventHandler(event => createBlogTaxonomy(event))
