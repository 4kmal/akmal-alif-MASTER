import { getBlogTaxonomy } from '../../../services/blog-studio'

export default eventHandler(event => getBlogTaxonomy(event))
