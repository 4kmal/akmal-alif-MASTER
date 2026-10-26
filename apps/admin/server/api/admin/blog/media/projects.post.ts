import { createMediaProject } from '../../../../services/blog-studio'

export default eventHandler(event => createMediaProject(event))
