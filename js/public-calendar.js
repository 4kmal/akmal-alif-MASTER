const TIME_ZONE = 'Asia/Kuala_Lumpur';
const CALENDAR_ENDPOINT = '/api/calendar';
const REFRESH_INTERVAL_MS = 60_000;
const MAX_RANGE_DAYS = 62;

const controllers = new WeakMap();

function getDateParts(value, timeZone = TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.formatToParts(value).reduce((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
}

export function formatCalendarDateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = getDateParts(value);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';

  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : candidate;
}

function parseDateOnly(value) {
  const date = formatCalendarDateOnly(value);
  if (!date) return null;

  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function startOfMonth(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonthExclusive(value) {
  const date = startOfMonth(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function mondayIndex(date) {
  return (date.getUTCDay() + 6) % 7;
}

export function getCalendarMonthRange(value) {
  const monthStart = startOfMonth(value);
  const monthEnd = endOfMonthExclusive(monthStart);
  const gridStart = addDays(monthStart, -mondayIndex(monthStart));
  const lastDay = addDays(monthEnd, -1);
  const gridEnd = addDays(lastDay, 6 - mondayIndex(lastDay) + 1);

  return {
    monthStart: formatCalendarDateOnly(monthStart),
    monthEnd: formatCalendarDateOnly(addDays(monthEnd, -1)),
    start: formatCalendarDateOnly(gridStart),
    end: formatCalendarDateOnly(gridEnd),
    endExclusive: formatCalendarDateOnly(gridEnd),
  };
}

function clampRange(start, end) {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (!startDate || !endDate || endDate <= startDate) return null;

  const maximumEnd = addDays(startDate, MAX_RANGE_DAYS);
  return {
    start: formatCalendarDateOnly(startDate),
    end: formatCalendarDateOnly(endDate > maximumEnd ? maximumEnd : endDate),
  };
}

function getEventField(event, names) {
  for (const name of names) {
    if (event && event[name] !== undefined && event[name] !== null && event[name] !== '') return event[name];
  }
  return null;
}

function isPrivateEvent(event) {
  const visibility = String(getEventField(event, ['visibility', 'access', 'audience', 'scope']) ?? '').trim().toLowerCase();
  const status = String(event?.status ?? '').trim().toLowerCase();
  return event?.private === true
    || event?.is_private === true
    || ['private', 'internal', 'secret', 'draft'].includes(visibility)
    || ['private', 'internal', 'secret', 'draft'].includes(status);
}

function isBusyEvent(event) {
  const visibility = String(getEventField(event, ['visibility', 'access', 'audience', 'scope']) ?? '').trim().toLowerCase();
  const status = String(event?.status ?? '').trim().toLowerCase();
  return event?.busy === true
    || event?.is_busy === true
    || visibility === 'busy'
    || status === 'busy';
}

function isAllDayEvent(event, startValue) {
  const kind = String(getEventField(event, ['kind', 'event_type', 'date_type']) ?? '').trim().toLowerCase();
  return event?.all_day === true
    || event?.allDay === true
    || event?.dateonly === true
    || event?.date_only === true
    || ['all-day', 'allday', 'dateonly', 'date-only'].includes(kind)
    || /^\d{4}-\d{2}-\d{2}$/.test(String(startValue ?? '').trim());
}

function normaliseDateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const source = String(value ?? '').trim();
  if (!source) return null;

  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normaliseCalendarEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object' || isPrivateEvent(rawEvent)) return null;

  const startValue = getEventField(rawEvent, ['start', 'start_at', 'start_utc', 'starts_at', 'date', 'start_date']);
  const endValue = getEventField(rawEvent, ['end', 'end_at', 'end_utc', 'ends_at', 'end_date']);
  if (!startValue) return null;

  const allDay = isAllDayEvent(rawEvent, startValue);
  let start;
  let end;
  let sortValue;

  if (allDay) {
    start = formatCalendarDateOnly(startValue);
    if (!start) return null;
    end = formatCalendarDateOnly(endValue) || formatCalendarDateOnly(addDays(parseDateOnly(start), 1));
    if (!end || end <= start) end = formatCalendarDateOnly(addDays(parseDateOnly(start), 1));
    sortValue = parseDateOnly(start)?.getTime() ?? Number.POSITIVE_INFINITY;
  } else {
    const startDate = normaliseDateTime(startValue);
    const endDate = normaliseDateTime(endValue) || (startDate ? new Date(startDate.getTime() + 60 * 60 * 1000) : null);
    if (!startDate || !endDate || endDate <= startDate) return null;
    start = startDate.toISOString();
    end = endDate.toISOString();
    sortValue = startDate.getTime();
  }

  const busy = isBusyEvent(rawEvent);
  const id = String(getEventField(rawEvent, ['id', 'event_id', 'uid']) ?? `${start}:${end}`).trim();
  const title = busy ? 'Busy' : String(getEventField(rawEvent, ['title', 'name', 'summary']) ?? 'Public event').trim() || 'Public event';

  return {
    id,
    title,
    start,
    end,
    allDay,
    busy,
    online: Boolean(rawEvent.online || rawEvent.is_online || rawEvent.is_virtual || rawEvent.online_url || rawEvent.meeting_url || rawEvent.location_type === 'online'),
    onlineUrl: busy ? '' : String(getEventField(rawEvent, ['online_url', 'meeting_url', 'url']) ?? '').trim(),
    location: busy ? '' : String(getEventField(rawEvent, ['location', 'venue']) ?? '').trim(),
    description: busy ? '' : String(rawEvent.description ?? '').trim(),
    sortValue,
    source: rawEvent,
  };
}

export function normaliseCalendarEvents(payload) {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return values
    .map(normaliseCalendarEvent)
    .filter(Boolean)
    .sort((left, right) => left.sortValue - right.sortValue || left.id.localeCompare(right.id));
}

function eventOverlapsRange(event, start, end) {
  if (event.allDay) return event.start < end && event.end > start;
  const startTime = Date.parse(event.start);
  const endTime = Date.parse(event.end);
  const rangeStart = Date.parse(`${start}T00:00:00Z`);
  const rangeEnd = Date.parse(`${end}T00:00:00Z`);
  return startTime < rangeEnd && endTime > rangeStart;
}

function eventDateOnly(event) {
  if (event.allDay) return event.start;
  return formatCalendarDateOnly(new Date(event.start));
}

function formatMonthLabel(month) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);
}

function formatLongDate(dateOnly) {
  const date = parseDateOnly(dateOnly);
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : dateOnly;
}

function formatEventTime(event) {
  if (event.allDay) return 'All day';

  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  });
  const start = formatter.format(new Date(event.start));
  const end = formatter.format(new Date(event.end));
  return `${start}–${end}`;
}

function createElement(documentRef, tag, className, text) {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isVisible(documentRef) {
  return documentRef?.hidden !== true && documentRef?.visibilityState !== 'hidden';
}

function getTodayDateOnly(nowRef) {
  return formatCalendarDateOnly(new Date(nowRef()));
}

function monthFromKey(key) {
  const match = String(key ?? '').match(/^(\d{4})-(\d{2})$/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : startOfMonth(new Date());
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(date, amount) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function buildRangeForMonth(month) {
  const range = getCalendarMonthRange(month);
  const bounded = clampRange(range.start, range.end);
  return bounded || { start: range.start, end: range.end };
}

function getPayloadEvents(payload) {
  return normaliseCalendarEvents(payload);
}

function readMonthEvents(events, dateOnly) {
  return events
    .filter((event) => eventOverlapsRange(event, dateOnly, formatCalendarDateOnly(addDays(parseDateOnly(dateOnly), 1))))
    .sort((left, right) => left.sortValue - right.sortValue);
}

function getUpcomingEvents(events, nowRef) {
  const now = Number(nowRef());
  return events
    .filter((event) => event.allDay
      ? event.end >= getTodayDateOnly(nowRef)
      : Date.parse(event.end) > now)
    .slice(0, 3);
}

function renderUpcoming(state) {
  const list = state.elements.upcoming;
  if (!list) return;
  list.replaceChildren();

  const upcoming = getUpcomingEvents(state.events, state.nowRef);
  if (!upcoming.length) {
    list.appendChild(createElement(state.documentRef, 'li', 'calendar-empty', 'No public events'));
    return;
  }

  upcoming.forEach((event) => {
    const item = createElement(state.documentRef, 'li', 'calendar-upcoming-item');
    const date = createElement(state.documentRef, 'span', 'calendar-upcoming-date', formatLongDate(eventDateOnly(event)));
    const title = createElement(state.documentRef, 'span', 'calendar-upcoming-title', event.title);
    const time = createElement(state.documentRef, 'span', 'calendar-upcoming-time', formatEventTime(event));
    item.append(date, title, time);
    if (event.online) item.appendChild(createElement(state.documentRef, 'span', 'calendar-event-badge', 'Online'));
    list.appendChild(item);
  });
}

function renderAgenda(state) {
  const agenda = state.elements.agenda;
  if (!agenda) return;
  agenda.replaceChildren();

  const heading = createElement(state.documentRef, 'h4', 'calendar-agenda-title', formatLongDate(state.selectedDate));
  agenda.appendChild(heading);
  const events = readMonthEvents(state.events, state.selectedDate);

  if (!events.length) {
    agenda.appendChild(createElement(state.documentRef, 'p', 'calendar-empty', 'No public events'));
    return;
  }

  const list = createElement(state.documentRef, 'ol', 'calendar-agenda-list');
  events.forEach((event) => {
    const item = createElement(state.documentRef, 'li', 'calendar-agenda-item');
    const title = createElement(state.documentRef, 'strong', 'calendar-agenda-event-title', event.title);
    const time = createElement(state.documentRef, 'span', 'calendar-agenda-event-time', formatEventTime(event));
    item.append(title, time);
    if (event.location) item.appendChild(createElement(state.documentRef, 'span', 'calendar-agenda-event-location', event.location));
    if (event.online) item.appendChild(createElement(state.documentRef, 'span', 'calendar-event-badge', 'Online'));

    const actions = createElement(state.documentRef, 'div', 'calendar-event-actions');
    ['Interested', 'Planning'].forEach((label) => {
      const button = createElement(state.documentRef, 'button', 'calendar-participation-button', label);
      button.type = 'button';
      button.dataset.calendarParticipation = label.toLowerCase();
      button.dataset.calendarEventId = event.id;
      const selected = state.participation.get(event.id) === label.toLowerCase();
      button.setAttribute('aria-pressed', String(selected));
      if (selected) button.classList.add('is-selected');
      actions.appendChild(button);
    });
    item.appendChild(actions);
    list.appendChild(item);
  });
  agenda.appendChild(list);
}

function renderGrid(state) {
  const grid = state.elements.grid;
  if (!grid) return;
  grid.replaceChildren();

  const month = monthFromKey(state.monthKey);
  const range = getCalendarMonthRange(month);
  const first = parseDateOnly(range.start);
  const last = parseDateOnly(range.end);
  const today = getTodayDateOnly(state.nowRef);
  const selected = state.selectedDate;
  const date = new Date(first.getTime());

  while (date < last) {
    const dateOnly = formatCalendarDateOnly(date);
    const button = createElement(state.documentRef, 'button', 'calendar-day', String(date.getUTCDate()));
    button.type = 'button';
    button.setAttribute('role', 'gridcell');
    button.dataset.calendarDate = dateOnly;
    button.setAttribute('aria-label', formatLongDate(dateOnly));
    button.setAttribute('aria-selected', String(dateOnly === selected));
    button.tabIndex = dateOnly === selected ? 0 : -1;
    if (date.getUTCMonth() !== month.getUTCMonth()) button.classList.add('is-outside-month');
    if (dateOnly === today) button.classList.add('is-today');
    if (dateOnly === selected) button.classList.add('is-selected');

    const events = readMonthEvents(state.events, dateOnly);
    if (events.length) {
      const marker = createElement(state.documentRef, 'span', 'calendar-day-marker');
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = events.length > 1 ? `${Math.min(events.length, 9)}` : '•';
      button.appendChild(marker);
    }
    grid.appendChild(button);
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

function render(state) {
  const month = monthFromKey(state.monthKey);
  if (state.elements.monthTitle) state.elements.monthTitle.textContent = formatMonthLabel(month);
  if (state.elements.grid) state.elements.grid.setAttribute('aria-label', formatMonthLabel(month));
  renderUpcoming(state);
  renderGrid(state);
  renderAgenda(state);

  if (state.elements.status) {
    state.elements.status.textContent = state.error
      ? 'Calendar is temporarily unavailable. Showing the last public schedule.'
      : state.loading
        ? 'Updating public events…'
        : '';
  }
}

function setMonth(state, month) {
  state.monthKey = monthKey(startOfMonth(month));
  const monthDate = monthFromKey(state.monthKey);
  const selected = parseDateOnly(state.selectedDate);
  const selectedMonth = selected ? monthKey(selected) : '';
  if (selectedMonth !== state.monthKey) state.selectedDate = formatCalendarDateOnly(monthDate);
  render(state);
  void refresh(state, true);
}

function selectDate(state, dateOnly) {
  if (!parseDateOnly(dateOnly)) return;
  state.selectedDate = dateOnly;
  const selectedMonth = monthKey(parseDateOnly(dateOnly));
  if (selectedMonth !== state.monthKey) state.monthKey = selectedMonth;
  render(state);
}

function handleGridKeydown(state, event) {
  const current = event.target?.closest?.('[data-calendar-date]');
  if (!current) return;
  const currentDate = parseDateOnly(current.dataset.calendarDate);
  if (!currentDate) return;

  let nextDate = null;
  if (event.key === 'ArrowLeft') nextDate = addDays(currentDate, -1);
  if (event.key === 'ArrowRight') nextDate = addDays(currentDate, 1);
  if (event.key === 'ArrowUp') nextDate = addDays(currentDate, -7);
  if (event.key === 'ArrowDown') nextDate = addDays(currentDate, 7);
  if (event.key === 'PageUp') nextDate = shiftMonth(currentDate, -1);
  if (event.key === 'PageDown') nextDate = shiftMonth(currentDate, 1);

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectDate(state, current.dataset.calendarDate);
    return;
  }
  if (!nextDate) return;

  event.preventDefault();
  const nextDateOnly = formatCalendarDateOnly(nextDate);
  selectDate(state, nextDateOnly);
  state.elements.grid?.querySelector(`[data-calendar-date="${nextDateOnly}"]`)?.focus();
}

function bind(state) {
  const { documentRef, elements } = state;
  elements.grid?.addEventListener('click', (event) => {
    const day = event.target?.closest?.('[data-calendar-date]');
    if (day) selectDate(state, day.dataset.calendarDate);
  });
  elements.grid?.addEventListener('keydown', (event) => handleGridKeydown(state, event));
  elements.prev?.addEventListener('click', () => setMonth(state, shiftMonth(monthFromKey(state.monthKey), -1)));
  elements.next?.addEventListener('click', () => setMonth(state, shiftMonth(monthFromKey(state.monthKey), 1)));
  elements.today?.addEventListener('click', () => {
    const today = getTodayDateOnly(state.nowRef);
    state.selectedDate = today;
    setMonth(state, startOfMonth(parseDateOnly(today)));
  });
  elements.monthToggle?.addEventListener('click', () => {
    const expanded = elements.monthToggle.getAttribute('aria-expanded') === 'true';
    elements.monthToggle.setAttribute('aria-expanded', String(!expanded));
    elements.monthToggle.querySelector('span:last-child').textContent = expanded ? '+' : '−';
    if (elements.monthPanel) elements.monthPanel.hidden = expanded;
  });
  elements.agenda?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-calendar-participation]');
    if (!button) return;
    const id = button.dataset.calendarEventId;
    const value = button.dataset.calendarParticipation;
    const current = state.participation.get(id);
    if (current === value) state.participation.delete(id);
    else state.participation.set(id, value);
    render(state);
    if (state.elements.status) state.elements.status.textContent = current === value
      ? 'Participation preference cleared on this device.'
      : `Marked ${value} for this event on this device.`;
  });

  const refreshOnVisible = () => {
    if (isVisible(documentRef)) void refresh(state, false);
  };
  documentRef?.addEventListener?.('visibilitychange', refreshOnVisible);
  state.cleanup.push(() => documentRef?.removeEventListener?.('visibilitychange', refreshOnVisible));
  const windowRef = documentRef?.defaultView ?? globalThis.window;
  windowRef?.addEventListener?.('online', refreshOnVisible);
  state.cleanup.push(() => windowRef?.removeEventListener?.('online', refreshOnVisible));
}

function elementsFor(root, documentRef) {
  const query = (selector) => root?.querySelector?.(selector) ?? documentRef?.querySelector?.(selector);
  return {
    upcoming: query('[data-calendar-upcoming]'),
    monthToggle: query('[data-calendar-month-toggle]'),
    monthPanel: query('[data-calendar-month-panel]'),
    monthTitle: query('[data-calendar-month-title]'),
    prev: query('[data-calendar-prev]'),
    next: query('[data-calendar-next]'),
    today: query('[data-calendar-today]'),
    grid: query('[data-calendar-grid]'),
    agenda: query('[data-calendar-agenda]'),
    status: query('[data-calendar-status]'),
  };
}

export async function refresh(state, force = false) {
  if (!state || state.disposed || !isVisible(state.documentRef)) return state?.events ?? [];
  const range = buildRangeForMonth(monthFromKey(state.monthKey));
  const cacheKey = `${range.start}:${range.end}`;
  const cached = state.cache.get(cacheKey);
  const now = Number(state.nowRef());
  if (!force && cached && now - cached.timestamp < REFRESH_INTERVAL_MS) {
    state.events = cached.events;
    state.error = '';
    render(state);
    return state.events;
  }
  if (state.request) {
    state.refreshAgain = true;
    return state.request;
  }

  state.loading = true;
  state.error = '';
  render(state);
  const requestUrl = `${CALENDAR_ENDPOINT}?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
  state.request = Promise.resolve()
    .then(() => state.fetchRef(requestUrl, { headers: { Accept: 'application/json' } }))
    .then(async (response) => {
      if (!response?.ok) throw new Error(`Calendar request failed (${response?.status ?? 'unknown'})`);
      const payload = await response.json();
      const events = getPayloadEvents(payload).filter((event) => eventOverlapsRange(event, range.start, range.end));
      state.cache.set(cacheKey, { timestamp: Number(state.nowRef()), events });
      state.events = events;
      state.error = '';
      return events;
    })
    .catch((error) => {
      state.error = error;
      return state.events;
    })
    .finally(() => {
      state.loading = false;
      state.request = null;
      render(state);
      if (state.refreshAgain) {
        state.refreshAgain = false;
        void refresh(state, true);
      }
    });
  return state.request;
}

export function createPublicCalendarController({
  root,
  documentRef = globalThis.document,
  fetchRef = globalThis.fetch,
  nowRef = () => Date.now(),
  setIntervalRef = globalThis.setInterval,
  clearIntervalRef = globalThis.clearInterval,
} = {}) {
  if (!root || !documentRef) return null;
  const elements = elementsFor(root, documentRef);
  if (!elements.grid || !elements.agenda) return null;

  const today = getTodayDateOnly(nowRef);
  const state = {
    root,
    documentRef,
    fetchRef: typeof fetchRef === 'function' ? fetchRef : () => Promise.reject(new Error('Calendar fetch is unavailable')),
    nowRef,
    elements,
    monthKey: monthKey(startOfMonth(parseDateOnly(today) || new Date())),
    selectedDate: today,
    events: [],
    participation: new Map(),
    cache: new Map(),
    cleanup: [],
    request: null,
    refreshAgain: false,
    loading: false,
    error: null,
    disposed: false,
    intervalId: null,
  };

  const viewportWidth = Number(documentRef.defaultView?.innerWidth ?? 0);
  if (viewportWidth >= 1280 && elements.monthToggle && elements.monthPanel) {
    elements.monthToggle.setAttribute('aria-expanded', 'true');
    elements.monthToggle.querySelector('span:last-child').textContent = '−';
    elements.monthPanel.hidden = false;
  }

  bind(state);
  render(state);
  if (typeof setIntervalRef === 'function') {
    state.intervalId = setIntervalRef(() => {
      if (isVisible(documentRef)) void refresh(state, false);
    }, REFRESH_INTERVAL_MS);
    state.cleanup.push(() => clearIntervalRef?.(state.intervalId));
  }
  void refresh(state, true);

  state.dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.cleanup.splice(0).forEach((cleanup) => cleanup());
    state.elements.grid?.replaceChildren();
    state.elements.agenda?.replaceChildren();
    state.elements.upcoming?.replaceChildren();
  };
  state.getState = () => ({
    monthKey: state.monthKey,
    selectedDate: state.selectedDate,
    events: state.events.slice(),
    loading: state.loading,
    error: state.error,
    disposed: state.disposed,
  });
  return state;
}

export function initPublicCalendar(root = globalThis.document?.querySelector?.('#calendar-rail')) {
  if (!root) return null;
  const documentRef = root.ownerDocument ?? globalThis.document;
  const existing = controllers.get(root);
  if (existing && !existing.disposed) {
    render(existing);
    return existing;
  }
  existing?.dispose?.();
  const controller = createPublicCalendarController({ root, documentRef, fetchRef: documentRef?.defaultView?.fetch?.bind(documentRef.defaultView) ?? globalThis.fetch });
  if (controller) controllers.set(root, controller);
  return controller;
}

export function disposePublicCalendar(root = globalThis.document?.querySelector?.('#calendar-rail')) {
  const controller = root ? controllers.get(root) : null;
  controller?.dispose?.();
  if (root) controllers.delete(root);
}

const publicCalendarApi = {
  init: initPublicCalendar,
  dispose: disposePublicCalendar,
  create: createPublicCalendarController,
  refresh,
  normaliseCalendarEvent,
  normaliseCalendarEvents,
  getCalendarMonthRange,
};

if (typeof window !== 'undefined') window.PublicCalendar = publicCalendarApi;
