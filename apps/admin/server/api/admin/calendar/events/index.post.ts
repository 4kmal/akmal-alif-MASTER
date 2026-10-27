import { createCalendarEvent } from '../../../../services/calendar'

export default eventHandler(event => createCalendarEvent(event))
