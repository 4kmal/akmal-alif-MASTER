import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCalendarMonthRange,
  normaliseCalendarEvent,
  normaliseCalendarEvents,
  refresh,
} from '../js/public-calendar.js';

function renderElements() {
  const element = {
    textContent: '',
    hidden: false,
    replaceChildren() {},
    appendChild() {},
    append() {},
    setAttribute() {},
    querySelector() { return null; },
  };
  return {
    upcoming: { ...element },
    monthToggle: null,
    monthPanel: null,
    monthTitle: { ...element },
    prev: null,
    next: null,
    today: null,
    grid: { ...element },
    agenda: { ...element },
    status: { ...element },
  };
}

test('calendar keeps private events out and redacts busy details', () => {
  assert.equal(normaliseCalendarEvent({ id: 'private', title: 'Secret', start: '2026-10-28T01:00:00Z', visibility: 'private' }), null);

  const busy = normaliseCalendarEvent({
    id: 'busy',
    title: 'Private appointment',
    start: '2026-10-28T01:00:00Z',
    end: '2026-10-28T02:00:00Z',
    busy: true,
    location: 'Private room',
    description: 'Should never be public',
  });

  assert.deepEqual({ title: busy.title, location: busy.location, description: busy.description, busy: busy.busy }, {
    title: 'Busy',
    location: '',
    description: '',
    busy: true,
  });
});

test('calendar preserves UTC timed boundaries and date-only exclusive ends', () => {
  const timed = normaliseCalendarEvent({ id: 'utc', start: '2026-10-31T16:00:00Z', end: '2026-10-31T17:30:00Z' });
  assert.equal(timed.start, '2026-10-31T16:00:00.000Z');
  assert.equal(timed.end, '2026-10-31T17:30:00.000Z');

  const allDay = normaliseCalendarEvent({ id: 'day', dateonly: true, start: '2026-11-01', end: '2026-11-03', title: 'Open day' });
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.start, '2026-11-01');
  assert.equal(allDay.end, '2026-11-03');
});

test('calendar month grid starts on Monday and retains source order for equal times', () => {
  const range = getCalendarMonthRange(new Date('2026-10-01T00:00:00Z'));
  assert.equal(range.start, '2026-09-28');
  assert.equal(range.end, '2026-11-02');

  const events = normaliseCalendarEvents([
    { id: 'b', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' },
    { id: 'a', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' },
  ]);
  assert.deepEqual(events.map((event) => event.id), ['a', 'b']);
});

test('calendar keeps the last good events when a visible refresh fails', async () => {
  let now = 1_000;
  let shouldFail = false;
  const state = {
    documentRef: {
      hidden: false,
      visibilityState: 'visible',
      createElement() {
        return {
          append() {},
          appendChild() {},
          setAttribute() {},
          dataset: {},
          classList: { add() {} },
          className: '',
          textContent: '',
        };
      },
    },
    fetchRef: async () => {
      if (shouldFail) throw new Error('offline');
      return {
        ok: true,
        async json() {
          return [{ id: 'public', start: '2026-10-28T01:00:00Z', end: '2026-10-28T02:00:00Z', title: 'Public event' }];
        },
      };
    },
    nowRef: () => now,
    elements: renderElements(),
    monthKey: '2026-10',
    selectedDate: '2026-10-28',
    events: [],
    participation: new Map(),
    cache: new Map(),
    request: null,
    refreshAgain: false,
    loading: false,
    error: null,
    disposed: false,
  };

  await refresh(state, true);
  assert.equal(state.events.length, 1);
  shouldFail = true;
  now += 61_000;
  await refresh(state, true);
  assert.equal(state.events[0].id, 'public');
  assert.ok(state.error);
});
