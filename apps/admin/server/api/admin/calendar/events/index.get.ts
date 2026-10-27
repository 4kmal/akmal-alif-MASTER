import { listCalendarEvents } from '../../../../services/calendar'

export default eventHandler(event => listCalendarEvents(event))
