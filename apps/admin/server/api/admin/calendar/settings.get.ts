import { getCalendarSettings } from '../../../services/calendar'

export default eventHandler(event => getCalendarSettings(event))
