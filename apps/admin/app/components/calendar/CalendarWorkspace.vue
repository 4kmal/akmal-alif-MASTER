<script setup lang="ts">
import type { CalendarEvent, CalendarEventInput, CalendarEventStatus, CalendarSettings } from '@/utils/content-calendar'
import { Archive, CalendarDays, Check, ChevronRight, Clock3, LoaderCircle, RotateCcw, Save, ShieldCheck } from '@lucide/vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { formatDate } from '@/utils/blog-studio'
import { calendarPrivacyPreview, DEFAULT_CALENDAR_TIMEZONE, validateCalendarEvent, withCalendarVersion } from '@/utils/content-calendar'

const api = useBlogApi()
const events = ref<CalendarEvent[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(true)
const saving = ref(false)
const savingSettings = ref(false)
const error = ref('')
const notice = ref('')
const showArchived = ref(false)
const formErrors = ref<Partial<Record<keyof CalendarEventInput, string>>>({})

const settings = reactive<CalendarSettings>({ version: 0, timezone: DEFAULT_CALENDAR_TIMEZONE })
const form = reactive<CalendarEventInput & { version: number }>({
  version: 0,
  kind: 'event',
  title: '',
  description: '',
  location: '',
  url: '',
  timezone: DEFAULT_CALENDAR_TIMEZONE,
  start_at: null,
  end_at: null,
  all_day: false,
  date: null,
  end_date_exclusive: null,
  visibility: 'private',
  participation: 'interested',
  blocks_availability: false,
})

const visibleEvents = computed(() => events.value.filter(event => showArchived.value || event.status !== 'archived'))
const selectedEvent = computed(() => selectedId.value ? events.value.find(event => event.id === selectedId.value) ?? null : null)
const preview = computed(() => calendarPrivacyPreview(form))
const previewTiming = computed(() => {
  if (form.visibility === 'private')
    return ''
  if (preview.value.all_day)
    return preview.value.date && preview.value.end_date_exclusive ? `${preview.value.date} → ${preview.value.end_date_exclusive} (end exclusive)` : 'Choose an all-day date range.'
  if (!preview.value.start_at || !preview.value.end_at)
    return 'Choose a UTC time window.'
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  return `${formatter.format(new Date(preview.value.start_at))} → ${formatter.format(new Date(preview.value.end_at))} UTC`
})

function localInput(value: string | null) {
  if (!value)
    return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()))
    return ''
  return date.toISOString().slice(0, 16)
}

function utcValue(value: string) {
  if (!value)
    return null
  const date = new Date(`${value}:00.000Z`)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}

function resetForm() {
  selectedId.value = null
  Object.assign(form, {
    version: 0,
    kind: 'event',
    title: '',
    description: '',
    location: '',
    url: '',
    timezone: settings.timezone || DEFAULT_CALENDAR_TIMEZONE,
    start_at: null,
    end_at: null,
    all_day: false,
    date: null,
    end_date_exclusive: null,
    visibility: 'private',
    participation: 'interested',
    blocks_availability: false,
  })
  formErrors.value = {}
}

function editEvent(event: CalendarEvent) {
  selectedId.value = event.id
  Object.assign(form, {
    version: event.version,
    kind: event.kind,
    title: event.title,
    description: event.description,
    location: event.location,
    url: event.url,
    timezone: event.timezone,
    start_at: localInput(event.start_at),
    end_at: localInput(event.end_at),
    all_day: event.all_day,
    date: event.date,
    end_date_exclusive: event.end_date_exclusive,
    visibility: event.visibility,
    participation: event.participation,
    blocks_availability: event.blocks_availability,
  })
  formErrors.value = {}
  notice.value = ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [eventResult, savedSettings] = await Promise.all([api.listCalendarEvents({ include_archived: true }), api.getCalendarSettings()])
    events.value = eventResult.events
    Object.assign(settings, savedSettings)
    if (!selectedId.value)
      resetForm()
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load calendar data.'
  }
  finally {
    loading.value = false
  }
}

function payload() {
  return {
    ...form,
    start_at: form.all_day ? null : utcValue(form.start_at || ''),
    end_at: form.all_day ? null : utcValue(form.end_at || ''),
    date: form.all_day ? form.date : null,
    end_date_exclusive: form.all_day ? form.end_date_exclusive : null,
  }
}

async function saveEvent() {
  const next = payload()
  const validation = validateCalendarEvent(next)
  formErrors.value = validation.errors
  if (!validation.valid)
    return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const saved = selectedId.value
      ? await api.updateCalendarEvent(selectedId.value, withCalendarVersion(next, form.version))
      : await api.createCalendarEvent(next)
    const index = events.value.findIndex(event => event.id === saved.id)
    if (index >= 0)
      events.value[index] = saved
    else
      events.value.unshift(saved)
    editEvent(saved)
    notice.value = 'Calendar event saved.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'The event changed elsewhere. Refresh and review the conflict.'
  }
  finally {
    saving.value = false
  }
}

async function changeStatus(event: CalendarEvent, status: CalendarEventStatus) {
  error.value = ''
  try {
    const saved = await api.setCalendarEventStatus(event.id, status, event.version)
    const index = events.value.findIndex(item => item.id === saved.id)
    if (index >= 0)
      events.value[index] = saved
    if (selectedId.value === saved.id)
      editEvent(saved)
    notice.value = status === 'archived' ? 'Event archived.' : 'Event restored.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not change the event status.'
  }
}

async function saveSettings() {
  savingSettings.value = true
  error.value = ''
  try {
    const saved = await api.saveCalendarSettings({ version: settings.version, timezone: settings.timezone })
    Object.assign(settings, saved)
    if (!selectedId.value)
      form.timezone = saved.timezone
    notice.value = 'Calendar settings saved.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Calendar settings changed elsewhere. Refresh and review the conflict.'
  }
  finally {
    savingSettings.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="calendar-workspace blog-studio-page">
    <div class="blog-page-heading">
      <div>
        <p class="blog-eyebrow">
          Private planning workspace
        </p><h1>Calendar</h1><p
          class="blog-page-intro"
        >
          Keep manual activities, events and meetings in one owner-controlled calendar. There is no booking, recurrence or external sync.
        </p>
      </div>
      <div class="blog-page-actions">
        <button type="button" class="blog-button" @click="resetForm">
          <CalendarDays :size="16" /> New event
        </button><label
          class="blog-toggle"
        ><input v-model="showArchived" type="checkbox"><span>Show archived</span></label>
      </div>
    </div>
    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="blog-alert blog-alert--notice" role="status">
      <Check :size="16" /> {{ notice }}
    </p>
    <section v-if="loading" class="blog-state">
      <LoaderCircle
        :size="22" class="blog-spin"
      /> Loading calendar…
    </section>
    <template v-else>
      <div class="calendar-layout">
        <section class="blog-panel calendar-list-panel" aria-labelledby="calendar-events-title">
          <div class="blog-panel__header">
            <div>
              <p class="blog-eyebrow">
                Manual events
              </p><h2 id="calendar-events-title">
                {{ visibleEvents.length }} events
              </h2>
            </div><Clock3 :size="21" aria-hidden="true" />
          </div>
          <div v-if="!visibleEvents.length" class="blog-empty-note">
            No events match this view. Create one to start planning.
          </div>
          <button
            v-for="event in visibleEvents" :key="event.id" type="button" class="
              calendar-event-row
            " :class="{ 'is-selected': event.id === selectedId, 'is-archived': event.status === 'archived' }" @click="editEvent(event)"
          >
            <span
              class="calendar-event-row__marker" :data-kind="event.kind"
            /><span><strong>{{ event.visibility === 'busy' ? 'Busy' : event.title }}</strong><small>{{ event.all_day ? event.date : formatDate(event.start_at) }} · {{ event.kind }} · {{ event.status }}</small></span><ChevronRight :size="16" />
          </button>
        </section>
        <section class="blog-panel calendar-editor-panel" aria-labelledby="calendar-event-editor-title">
          <div class="blog-panel__header">
            <div>
              <p class="blog-eyebrow">
                Event details
              </p><h2 id="calendar-event-editor-title">
                {{ selectedEvent ? 'Edit event' : 'New event' }}
              </h2>
            </div><button
              v-if="selectedEvent" type="button" class="
                blog-button blog-button--quiet
              " @click="resetForm"
            >
              Clear
            </button>
          </div>
          <div class="calendar-form-grid">
            <label class="blog-field"><span>Kind</span><select v-model="form.kind"><option value="activity">Activity</option><option value="event">Event</option><option value="meeting">Meeting</option></select><small
              v-if="formErrors.kind" class="blog-field-error"
            >{{ formErrors.kind }}</small></label>
            <label class="blog-field"><span>Title</span><input v-model="form.title" maxlength="200" placeholder="Event title"><small
              v-if="formErrors.title" class="blog-field-error"
            >{{ formErrors.title }}</small></label>
          </div>
          <label class="blog-field"><span>Description</span><textarea v-model="form.description" rows="4" maxlength="4000" /></label>
          <div class="calendar-form-grid">
            <label class="blog-field"><span>Location</span><input v-model="form.location" maxlength="400" placeholder="Optional location"></label><label
              class="blog-field"
            ><span>URL</span><input v-model="form.url" type="url" maxlength="1000" placeholder="https://"><small
              v-if="formErrors.url" class="blog-field-error"
            >{{ formErrors.url }}</small></label>
          </div>
          <label class="blog-toggle calendar-all-day"><input v-model="form.all_day" type="checkbox"><span>All-day event</span></label>
          <div v-if="form.all_day" class="calendar-form-grid">
            <label
              class="blog-field"
            ><span>Start date</span><input v-model="form.date" type="date"><small
              v-if="formErrors.date" class="blog-field-error"
            >{{ formErrors.date }}</small></label><label
              class="blog-field"
            ><span>End date (exclusive)</span><input v-model="form.end_date_exclusive" type="date"><small
              v-if="formErrors.end_date_exclusive" class="blog-field-error"
            >{{ formErrors.end_date_exclusive }}</small></label>
          </div>
          <div v-else class="calendar-form-grid">
            <label class="blog-field"><span>Start time (UTC)</span><input v-model="form.start_at" type="datetime-local"><small
              v-if="formErrors.start_at" class="blog-field-error"
            >{{ formErrors.start_at }}</small></label><label
              class="blog-field"
            ><span>End time (UTC)</span><input v-model="form.end_at" type="datetime-local"><small
              v-if="formErrors.end_at" class="blog-field-error"
            >{{ formErrors.end_at }}</small></label>
          </div>
          <div class="calendar-form-grid">
            <label class="blog-field"><span>Timezone</span><input v-model="form.timezone" list="calendar-timezones" placeholder="Asia/Kuala_Lumpur"><small
              v-if="formErrors.timezone" class="blog-field-error"
            >{{ formErrors.timezone }}</small></label><label
              class="blog-field"
            ><span>Visibility</span><select v-model="form.visibility"><option value="private">Private</option><option value="public">Public</option><option value="busy">Busy only</option></select></label>
          </div>
          <div class="calendar-form-grid">
            <label class="blog-field"><span>Participation</span><select v-model="form.participation"><option value="interested">Interested</option><option value="planning">Planning</option><option value="confirmed">Confirmed</option></select></label><label
              class="blog-toggle calendar-blocks"
            ><input v-model="form.blocks_availability" type="checkbox"><span>Blocks availability</span></label>
          </div>
          <div class="calendar-privacy-preview">
            <div class="blog-panel__header">
              <div>
                <p
                  class="blog-eyebrow"
                >
                  Privacy preview
                </p><h3>{{ preview.title || 'Untitled event' }}</h3>
              </div><ShieldCheck :size="18" />
            </div><p v-if="preview.description">
              {{ preview.description }}
            </p><p v-if="previewTiming" class="calendar-privacy-preview__timing">
              {{ previewTiming }}
            </p><span v-if="form.visibility === 'busy'">Only “Busy” and the time window are shown publicly.</span><span v-else-if="form.visibility === 'private'">No public information is shown for a private event.</span><span v-else>Public visitors can see the event details you entered.</span>
          </div>
          <div class="calendar-editor-actions">
            <button
              type="button" class="blog-button blog-button--primary" :disabled="saving" @click="saveEvent"
            >
              <Save :size="16" /> {{ saving ? 'Saving…' : 'Save event' }}
            </button><button
              v-if="selectedEvent" type="button" class="
                blog-button blog-button--quiet
              " @click="changeStatus(selectedEvent, selectedEvent.status === 'archived' ? 'active' : 'archived')"
            >
              <RotateCcw v-if="selectedEvent.status === 'archived'" :size="16" /><Archive v-else :size="16" /> {{ selectedEvent.status === 'archived' ? 'Restore' : 'Archive' }}
            </button>
          </div>
        </section>
      </div>
      <section class="blog-panel calendar-settings-panel">
        <div
          class="blog-panel__header"
        >
          <div>
            <p
              class="blog-eyebrow"
            >
              Calendar settings
            </p><h2>Default timezone</h2>
          </div><Save :size="20" aria-hidden="true" />
        </div><div
          class="calendar-settings-form"
        >
          <label
            class="blog-field"
          ><span>Timezone for new events</span><input v-model="settings.timezone" list="calendar-timezones" placeholder="Asia/Kuala_Lumpur"></label><button
            type="button" class="blog-button" :disabled="savingSettings" @click="saveSettings"
          >
            <Save :size="16" /> {{ savingSettings ? 'Saving…' : 'Save timezone' }}
          </button>
        </div><datalist id="calendar-timezones">
          <option value="Asia/Kuala_Lumpur" /><option value="Asia/Singapore" /><option value="UTC" /><option value="Europe/London" /><option value="America/New_York" />
        </datalist>
      </section>
    </template>
  </main>
</template>
