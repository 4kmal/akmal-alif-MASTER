import { projectIdFromEvent, updateMediaProject } from '../../../../../services/blog-studio'

export default eventHandler(event => updateMediaProject(event, projectIdFromEvent(event)))
