const TIME_ZONE = 'Asia/Kuala_Lumpur';
const CALENDAR_ENDPOINT = '/api/calendar';
const REFRESH_INTERVAL_MS = 60_000;
const MAX_RANGE_DAYS = 366;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function formatUtcDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseStrictDateOnly(value) {
  const match = String(value ?? '').trim().match(DATE_ONLY_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function formatCalendarDateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = getDateParts(value);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const date = parseStrictDateOnly(`${match[1]}-${match[2]}-${match[3]}`);
  return date ? formatUtcDateOnly(date) : '';
}

export function parseCalendarDateOnly(value) {
  return parseStrictDateOnly(value);
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  return parseStrictDateOnly(value);
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
    monthStart: formatUtcDateOnly(monthStart),
    monthEnd: formatUtcDateOnly(lastDay),
    start: formatUtcDateOnly(gridStart),
    end: formatUtcDateOnly(gridEnd),
    endExclusive: formatUtcDateOnly(gridEnd),
  };
}

function clampRange(start, end) {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (!startDate || !endDate || endDate <= startDate) return null;

  const maximumEnd = addDays(startDate, MAX_RANGE_DAYS);
  return {
    start: formatUtcDateOnly(startDate),
    end: formatUtcDateOnly(endDate > maximumEnd ? maximumEnd : endDate),
  };
}

function normaliseDateTime(value) {
  const source = String(value ?? '').trim();
  if (!source) return null;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeEventUrl(value) {
  const source = String(value ?? '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source, 'https://akmalalif.com');
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return source;
  } catch {
    return '';
  }
}

function sortId(event) {
  return String(event?.id ?? '');
}

export function normaliseCalendarEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object' || rawEvent.archived_at) return null;

  const visibility = String(rawEvent.visibility ?? '').trim().toLowerCase();
  if (!['public', 'busy'].includes(visibility)) return null;
  const busy = visibility === 'busy';
  const timezone = String(rawEvent.timezone ?? TIME_ZONE).trim() || TIME_ZONE;
  const allDay = rawEvent.all_day === true;
  let start;
  let end;
  let sortValue;

  if (allDay) {
    const startDate = parseStrictDateOnly(rawEvent.start_date);
    const endDate = parseStrictDateOnly(rawEvent.end_date);
    if (!startDate || !endDate || endDate <= startDate) return null;
    start = formatUtcDateOnly(startDate);
    end = formatUtcDateOnly(endDate);
    sortValue = startDate.getTime();
  } else {
    const startsAt = normaliseDateTime(rawEvent.starts_at);
    const endsAt = normaliseDateTime(rawEvent.ends_at);
    if (!startsAt || !endsAt || endsAt <= startsAt) return null;
    start = startsAt.toISOString();
    end = endsAt.toISOString();
    sortValue = startsAt.getTime();
  }

  const event = {
    title: busy ? 'Busy' : String(rawEvent.title ?? '').trim() || 'Public event',
    start,
    end,
    allDay,
    busy,
    visibility,
    timezone,
    sortValue,
  };

  if (allDay) {
    event.startDate = start;
    event.endDate = end;
  } else {
    event.startsAt = start;
    event.endsAt = end;
  }

  if (!busy) {
    const id = String(rawEvent.id ?? '').trim();
    if (id) event.id = id;
    event.description = String(rawEvent.description ?? '').trim();
    event.location = String(rawEvent.location ?? '').trim();
    event.url = safeEventUrl(rawEvent.url);
    event.kind = String(rawEvent.kind ?? '').trim();
    event.participation = String(rawEvent.participation ?? '').trim().toLowerCase();
    event.blocksAvailability = rawEvent.blocks_availability === true;
  }

  return event;
}

function sortEvents(events) {
  return events
    .filter(Boolean)
    .sort((left, right) => left.sortValue - right.sortValue || sortId(left).localeCompare(sortId(right)));
}

export function normaliseCalendarEvents(payload) {
  const values = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
  return sortEvents(values.map(normaliseCalendarEvent));
}

export function normaliseCalendarUpcoming(payload) {
  const values = Array.isArray(payload?.upcoming) ? payload.upcoming : [];
  return sortEvents(values.map(normaliseCalendarEvent)).slice(0, 3);
}

function malaysiaBoundaryMs(dateOnly) {
  const date = parseStrictDateOnly(dateOnly);
  return date ? Date.parse(`${formatUtcDateOnly(date)}T00:00:00+08:00`) : Number.NaN;
}

export function eventOverlapsRange(event, start, end) {
  if (!event || !parseStrictDateOnly(start) || !parseStrictDateOnly(end)) return false;
  if (event.allDay) return event.start < end && event.end > start;
  const startTime = Date.parse(event.start);
  const endTime = Date.parse(event.end);
  const rangeStart = malaysiaBoundaryMs(start);
  const rangeEnd = malaysiaBoundaryMs(end);
  return Number.isFinite(startTime) && Number.isFinite(endTime)
    && Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)
    && startTime < rangeEnd && endTime > rangeStart;
}

function eventDateOnly(event) {
  if (event.allDay) return event.start;
  return formatCalendarDateOnly(new Date(event.start));
}

function formatMonthLabel(month) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);
}

function formatLongDate(dateOnly) {
  const date = parseStrictDateOnly(dateOnly);
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : dateOnly;
}

function formatEventTime(event) {
  if (event.allDay) return 'All day';
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: event.timezone || TIME_ZONE,
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: TIME_ZONE,
    });
  }
  return `${formatter.format(new Date(event.start))}–${formatter.format(new Date(event.end))}`;
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
  const value = nowRef instanceof Function ? nowRef() : nowRef;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? formatUtcDateOnly(new Date()) : formatCalendarDateOnly(date);
}

function monthFromKey(key) {
  const match = String(key ?? '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
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
  return clampRange(range.start, range.end) || { start: range.start, end: range.end };
}

function readDayEvents(events, dateOnly) {
  const date = parseStrictDateOnly(dateOnly);
  if (!date) return [];
  const nextDate = formatUtcDateOnly(addDays(date, 1));
  return events.filter((event) => eventOverlapsRange(event, dateOnly, nextDate));
}

function isUpcoming(event, nowRef) {
  const today = getTodayDateOnly(nowRef);
  if (event.allDay) return event.end > today;
  return Date.parse(event.end) > Number(nowRef());
}

function renderUpcoming(state) {
  const list = state.elements.upcoming;
  if (!list) return;
  list.replaceChildren();
  const upcoming = (state.upcoming ?? []).filter((event) => isUpcoming(event, state.nowRef)).slice(0, 3);
  if (!upcoming.length) {
    list.appendChild(createElement(state.documentRef, 'li', 'calendar-empty', 'No public events'));
    return;
  }

  upcoming.forEach((event) => {
    const item = createElement(state.documentRef, 'li', 'calendar-upcoming-item');
    item.append(
      createElement(state.documentRef, 'span', 'calendar-upcoming-date', formatLongDate(eventDateOnly(event))),
      createElement(state.documentRef, 'span', 'calendar-upcoming-title', event.title),
      createElement(state.documentRef, 'span', 'calendar-upcoming-time', formatEventTime(event)),
    );
    list.appendChild(item);
  });
}

function appendEventDetails(state, item, event) {
  if (event.busy) return;
  if (event.description) item.appendChild(createElement(state.documentRef, 'p', 'calendar-event-description', event.description));
  if (event.location) item.appendChild(createElement(state.documentRef, 'span', 'calendar-agenda-event-location', event.location));
  if (event.url) {
    const link = createElement(state.documentRef, 'a', 'calendar-event-link', 'Open event details');
    link.href = event.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.appendChild(link);
  }
  if (event.kind || event.timezone) {
    const metadata = [event.kind, event.timezone].filter(Boolean).join(' · ');
    item.appendChild(createElement(state.documentRef, 'span', 'calendar-event-metadata', metadata));
  }
  if (event.participation) {
    item.appendChild(createElement(state.documentRef, 'span', 'calendar-event-participation', `Your participation: ${event.participation}`));
  }
  item.appendChild(createElement(
    state.documentRef,
    'span',
    `calendar-nonblocking${event.blocksAvailability ? '' : ' is-nonblocking'}`,
    event.blocksAvailability ? 'Blocks calendar' : 'Nonblocking',
  ));
}

function renderAgenda(state) {
  const agenda = state.elements.agenda;
  if (!agenda) return;
  agenda.replaceChildren();
  agenda.appendChild(createElement(state.documentRef, 'h4', 'calendar-agenda-title', formatLongDate(state.selectedDate)));
  const events = readDayEvents(state.events, state.selectedDate);
  if (!events.length) {
    agenda.appendChild(createElement(state.documentRef, 'p', 'calendar-empty', 'No public events'));
    return;
  }

  const list = createElement(state.documentRef, 'ol', 'calendar-agenda-list');
  events.forEach((event) => {
    const item = createElement(state.documentRef, 'li', 'calendar-agenda-item');
    item.append(
      createElement(state.documentRef, 'strong', 'calendar-agenda-event-title', event.title),
      createElement(state.documentRef, 'span', 'calendar-agenda-event-time', formatEventTime(event)),
    );
    appendEventDetails(state, item, event);
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
  const first = parseStrictDateOnly(range.start);
  const last = parseStrictDateOnly(range.end);
  if (!first || !last) return;
  const today = getTodayDateOnly(state.nowRef);
  const date = first;

  while (date < last) {
    const dateOnly = formatUtcDateOnly(date);
    const button = createElement(state.documentRef, 'button', 'calendar-day', String(date.getUTCDate()));
    button.type = 'button';
    button.setAttribute('role', 'gridcell');
    button.dataset.calendarDate = dateOnly;
    button.setAttribute('aria-label', formatLongDate(dateOnly));
    button.setAttribute('aria-selected', String(dateOnly === state.selectedDate));
    button.tabIndex = dateOnly === state.selectedDate ? 0 : -1;
    if (date.getUTCMonth() !== month.getUTCMonth()) button.classList.add('is-outside-month');
    if (dateOnly === today) button.classList.add('is-today');
    if (dateOnly === state.selectedDate) button.classList.add('is-selected');
    const events = readDayEvents(state.events, dateOnly);
    if (events.length) {
      const marker = createElement(state.documentRef, 'span', 'calendar-day-marker', events.length > 1 ? String(Math.min(events.length, 9)) : '•');
      marker.setAttribute('aria-hidden', 'true');
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
        ? (state.events.length || (state.upcoming ?? []).length
        ? 'Calendar is temporarily unavailable. Showing the last public schedule.'
        : 'Calendar is temporarily unavailable.')
      : state.loading
        ? 'Updating public events…'
        : '';
  }
}

function applyCachedMonth(state, key) {
  const cached = state.cache.get(key);
  state.events = cached?.events ? cached.events.slice() : [];
  state.error = cached?.error ?? null;
  if (cached?.upcoming) state.upcoming = cached.upcoming.slice();
}

function setMonth(state, month) {
  state.monthKey = monthKey(startOfMonth(month));
  const monthDate = monthFromKey(state.monthKey);
  const selected = parseDateOnly(state.selectedDate);
  if (!selected || monthKey(selected) !== state.monthKey) state.selectedDate = formatUtcDateOnly(monthDate);
  applyCachedMonth(state, state.monthKey);
  render(state);
  void refresh(state, true);
}

function selectDate(state, dateOnly) {
  const parsed = parseStrictDateOnly(dateOnly);
  if (!parsed) return;
  const nextMonthKey = monthKey(parsed);
  state.selectedDate = formatUtcDateOnly(parsed);
  if (nextMonthKey !== state.monthKey) {
    state.monthKey = nextMonthKey;
    applyCachedMonth(state, nextMonthKey);
    render(state);
    void refresh(state, true);
    return;
  }
  render(state);
}

function handleGridKeydown(state, event) {
  const current = event.target?.closest?.('[data-calendar-date]');
  if (!current) return;
  const currentDate = parseStrictDateOnly(current.dataset.calendarDate);
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
  const nextDateOnly = formatUtcDateOnly(nextDate);
  selectDate(state, nextDateOnly);
  state.elements.grid?.querySelector?.(`[data-calendar-date="${nextDateOnly}"]`)?.focus?.();
}

function listen(state, target, type, handler, options) {
  if (!target?.addEventListener) return;
  target.addEventListener(type, handler, options);
  state.cleanup.push(() => target.removeEventListener(type, handler, options));
}

function bind(state) {
  const { documentRef, elements } = state;
  listen(state, elements.grid, 'click', (event) => {
    const day = event.target?.closest?.('[data-calendar-date]');
    if (day) selectDate(state, day.dataset.calendarDate);
  });
  listen(state, elements.grid, 'keydown', (event) => handleGridKeydown(state, event));
  listen(state, elements.prev, 'click', () => setMonth(state, shiftMonth(monthFromKey(state.monthKey), -1)));
  listen(state, elements.next, 'click', () => setMonth(state, shiftMonth(monthFromKey(state.monthKey), 1)));
  listen(state, elements.today, 'click', () => {
    const today = getTodayDateOnly(state.nowRef);
    state.selectedDate = today;
    setMonth(state, startOfMonth(parseStrictDateOnly(today)));
  });
  listen(state, elements.monthToggle, 'click', () => {
    const expanded = elements.monthToggle.getAttribute('aria-expanded') === 'true';
    elements.monthToggle.setAttribute('aria-expanded', String(!expanded));
    const icon = elements.monthToggle.querySelector?.('span:last-child');
    if (icon) icon.textContent = expanded ? '+' : '−';
    if (elements.monthPanel) elements.monthPanel.hidden = expanded;
  });

  const refreshOnVisible = () => {
    if (isVisible(documentRef)) void refresh(state, true);
  };
  listen(state, documentRef, 'visibilitychange', refreshOnVisible);
  const windowRef = documentRef?.defaultView ?? globalThis.window;
  listen(state, windowRef, 'online', refreshOnVisible);
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

function abortRequest(state) {
  state.requestController?.abort?.();
  state.requestController = null;
}

export function refresh(state, force = false) {
  if (!state || state.disposed || !isVisible(state.documentRef)) return Promise.resolve(state?.events ?? []);
  const requestedMonthKey = state.monthKey;
  const range = buildRangeForMonth(monthFromKey(requestedMonthKey));
  const cached = state.cache.get(requestedMonthKey);
  const now = Number(state.nowRef());

  if (state.request) {
    state.queuedMonthKey = requestedMonthKey;
    state.queuedForce = state.queuedForce || force;
    return state.request;
  }

  if (!force && cached && now - cached.timestamp < REFRESH_INTERVAL_MS) {
    applyCachedMonth(state, requestedMonthKey);
    render(state);
    return Promise.resolve(state.events);
  }

  const token = ++state.requestToken;
  const abortController = typeof AbortController === 'function' ? new AbortController() : null;
  state.requestController = abortController;
  state.requestMonthKey = requestedMonthKey;
  state.loading = true;
  state.error = cached?.error ?? null;
  render(state);

  const requestUrl = `${CALENDAR_ENDPOINT}?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
  const request = Promise.resolve()
    .then(() => state.fetchRef(requestUrl, {
      headers: { Accept: 'application/json' },
      ...(abortController ? { signal: abortController.signal } : {}),
    }))
    .then(async (response) => {
      if (!response?.ok) throw new Error(`Calendar request failed (${response?.status ?? 'unknown'})`);
      return response.json();
    })
    .then((payload) => {
      if (state.disposed || token !== state.requestToken) return state.events;
      const events = normaliseCalendarEvents(payload).filter((event) => eventOverlapsRange(event, range.start, range.end));
      const upcoming = normaliseCalendarUpcoming(payload);
      state.cache.set(requestedMonthKey, { timestamp: Number(state.nowRef()), events, upcoming, error: null });
      state.upcoming = upcoming;
      if (state.monthKey === requestedMonthKey) {
        state.events = events;
        state.error = null;
      }
      return events;
    })
    .catch((error) => {
      if (state.disposed || token !== state.requestToken || error?.name === 'AbortError') return state.events;
      const stale = cached?.events ? cached.events.slice() : state.monthKey === requestedMonthKey ? state.events : [];
      const staleUpcoming = cached?.upcoming ? cached.upcoming.slice() : state.upcoming;
      state.cache.set(requestedMonthKey, {
        timestamp: cached?.timestamp ?? 0,
        events: stale,
        upcoming: staleUpcoming,
        error,
      });
      if (state.monthKey === requestedMonthKey) {
        state.events = stale;
        state.upcoming = staleUpcoming;
        state.error = error;
      }
      return stale;
    })
    .finally(() => {
      if (state.disposed || token !== state.requestToken) return;
      state.loading = false;
      state.request = null;
      state.requestController = null;
      render(state);
      const queuedMonthKey = state.queuedMonthKey;
      const queuedForce = state.queuedForce;
      state.queuedMonthKey = null;
      state.queuedForce = false;
      if (queuedMonthKey && !state.disposed) void refresh(state, queuedForce || queuedMonthKey !== state.monthKey);
    });

  state.request = request;
  return request;
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
    monthKey: monthKey(startOfMonth(parseStrictDateOnly(today) || new Date())),
    selectedDate: today,
    events: [],
    upcoming: [],
    cache: new Map(),
    cleanup: [],
    request: null,
    requestController: null,
    requestToken: 0,
    requestMonthKey: null,
    queuedMonthKey: null,
    queuedForce: false,
    loading: false,
    error: null,
    disposed: false,
    intervalId: null,
  };

  const viewportWidth = Number(documentRef.defaultView?.innerWidth ?? 0);
  if (viewportWidth >= 1280 && elements.monthToggle && elements.monthPanel) {
    elements.monthToggle.setAttribute('aria-expanded', 'true');
    const icon = elements.monthToggle.querySelector?.('span:last-child');
    if (icon) icon.textContent = '−';
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
    state.requestToken += 1;
    abortRequest(state);
    state.cleanup.splice(0).forEach((cleanup) => cleanup());
    state.request = null;
    state.elements.grid?.replaceChildren();
    state.elements.agenda?.replaceChildren();
    state.elements.upcoming?.replaceChildren();
  };
  state.getState = () => ({
    monthKey: state.monthKey,
    selectedDate: state.selectedDate,
    events: state.events.slice(),
    upcoming: state.upcoming.slice(),
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
  const controller = createPublicCalendarController({
    root,
    documentRef,
    fetchRef: documentRef?.defaultView?.fetch?.bind(documentRef.defaultView) ?? globalThis.fetch,
  });
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
  normaliseCalendarUpcoming,
  getCalendarMonthRange,
  parseCalendarDateOnly,
  eventOverlapsRange,
};

if (typeof window !== 'undefined') window.PublicCalendar = publicCalendarApi;
