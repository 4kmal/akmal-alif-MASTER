<script setup lang="ts">
import { Download } from '@lucide/vue'
import QRCodeStyling from 'qr-code-styling'

const props = withDefaults(defineProps<{
  data: string
  image?: string
}>(), {
  image: '',
})

const QR_EXPORT_TIMEOUT_MS = 10_000

const color = ref('#000000')
const isPreparing = ref(true)
const exportError = ref(false)
const cachedObjectUrl = ref<string | null>(null)
const qrCodeEl = useTemplateRef<HTMLElement>('qrCodeEl')
const isMounted = ref(false)
let generation = 0

function createQrOptions(type: 'canvas' | 'svg') {
  return {
    width: 256,
    height: 256,
    data: props.data,
    type,
    margin: 10,
    qrOptions: { typeNumber: 0 as const, mode: 'Byte' as const, errorCorrectionLevel: 'Q' as const },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.4,
      margin: 2,
      crossOrigin: 'anonymous',
    },
    dotsOptions: { type: 'dots' as const, color: color.value },
    backgroundOptions: { color: '#ffffff' },
    image: props.image,
    cornersSquareOptions: { type: 'extra-rounded' as const, color: color.value },
    cornersDotOptions: { type: 'dot' as const, color: color.value },
  }
}

const qrCode = new QRCodeStyling(createQrOptions('svg'))

function revokeCachedUrl() {
  if (!cachedObjectUrl.value)
    return

  URL.revokeObjectURL(cachedObjectUrl.value)
  cachedObjectUrl.value = null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('QR PNG export timed out'))
    }, timeoutMs)

    promise.then((value) => {
      clearTimeout(timeout)
      resolve(value)
    }, (error: unknown) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

function downloadName() {
  try {
    const url = new URL(props.data)
    const slug = url.pathname.split('/').filter(Boolean).pop()?.replace(/[^\w-]/g, '-').slice(0, 80)
    return `qr_${slug || 'code'}.png`
  }
  catch {
    return 'qr_code.png'
  }
}

async function preparePng() {
  const currentGeneration = ++generation
  revokeCachedUrl()
  isPreparing.value = true
  exportError.value = false

  try {
    // Use a fresh canvas renderer for every generation. qr-code-styling caches
    // its internal canvas, so reusing one after a color or image update can
    // export the previous appearance.
    const exportQrCode = new QRCodeStyling(createQrOptions('canvas'))
    const rawData = await withTimeout(exportQrCode.getRawData('png'), QR_EXPORT_TIMEOUT_MS)

    if (!isMounted.value || currentGeneration !== generation)
      return
    if (!(rawData instanceof Blob))
      throw new Error('QR PNG export returned no browser Blob')

    cachedObjectUrl.value = URL.createObjectURL(rawData)
  }
  catch (error) {
    if (isMounted.value && currentGeneration === generation) {
      exportError.value = true
      console.error('QR PNG export failed', error)
    }
  }
  finally {
    if (isMounted.value && currentGeneration === generation)
      isPreparing.value = false
  }
}

function triggerDownload(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = downloadName()
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function downloadQRCode() {
  if (isPreparing.value)
    return

  const url = cachedObjectUrl.value
  if (!url) {
    void preparePng()
    return
  }

  // The URL is prepared before the click, so the native download is invoked
  // synchronously within the user's gesture instead of from an async callback.
  triggerDownload(url)
}

function refreshQRCode() {
  if (!isMounted.value)
    return

  qrCode.update(createQrOptions('svg'))
  void preparePng()
}

watch([color, () => props.data, () => props.image], refreshQRCode)

onMounted(() => {
  isMounted.value = true
  if (qrCodeEl.value)
    qrCode.append(qrCodeEl.value)
  void preparePng()
})

onBeforeUnmount(() => {
  isMounted.value = false
  generation += 1
  revokeCachedUrl()
})
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <div
      ref="qrCodeEl"
      :data-text="data"
      role="img"
      :aria-label="$t('links.qr.text_alternative', { url: data })"
      class="rounded-lg border border-border bg-white p-1 shadow-sm"
    />
    <div class="flex items-center gap-4">
      <div class="relative flex items-center">
        <label
          class="
            relative size-11 cursor-pointer overflow-hidden rounded-full border
            border-input ring-offset-background
            focus-within:ring-3 focus-within:ring-ring/50
            lg:size-9
          "
          :style="{ backgroundColor: color }"
          :title="$t('links.change_qr_color')"
        >
          <input
            v-model="color"
            type="color"
            class="absolute inset-0 size-full cursor-pointer opacity-0"
            :aria-label="$t('links.change_qr_color')"
            :title="$t('links.change_qr_color')"
          >
        </label>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="isPreparing"
        :aria-busy="isPreparing"
        :aria-label="exportError ? $t('common.try_again') : $t('links.download_qr_code')"
        class="
          min-h-11
          lg:min-h-8
        "
        @click="downloadQRCode"
      >
        <Download aria-hidden="true" class="mr-2 size-4" />
        <span v-if="isPreparing">{{ $t('links.download_qr_code') }}…</span>
        <span v-else-if="exportError">{{ $t('common.try_again') }}</span>
        <span v-else>{{ $t('links.download_qr_code') }}</span>
      </Button>
    </div>
    <p
      v-if="exportError"
      role="status"
      aria-live="polite"
      class="text-sm text-destructive"
    >
      {{ $t('common.try_again') }}
    </p>
  </div>
</template>
