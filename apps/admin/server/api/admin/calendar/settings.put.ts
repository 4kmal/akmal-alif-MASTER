import { updateCalendarSettings } from '../../../services/calendar'

export default eventHandler(event => updateCalendarSettings(event))
