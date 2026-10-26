import type { DecodedGif, MediaClip, MediaOutput, ProcessedMedia } from '../../../shared/blog-media-project'
import { decompressFrame, parseGIF } from 'gifuct-js'
import { BLOG_MEDIA_SOURCE_LIMIT } from '../../../shared/blog-media-project'
import { fitMediaDimensions } from './project'

type MediaCanvas = HTMLCanvasElement | OffscreenCanvas

export function mediaCanvas(width: number, height: number): MediaCanvas {
  if (typeof OffscreenCanvas !== 'undefined')
    return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: MediaCanvas) {
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context)
    throw new Error('This browser could not create an image editing surface.')
  return context
}

export async function canvasBlob(canvas: MediaCanvas, type = 'image/png', quality = 0.9): Promise<Blob> {
  if ('convertToBlob' in canvas)
    return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image export could not finish.')), type, quality)
  })
}

export function assertMediaNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('Media processing was cancelled.', 'AbortError')
}

export async function inspectMedia(blob: Blob, mimeType = blob.type) {
  if (blob.size > BLOG_MEDIA_SOURCE_LIMIT)
    throw new Error('Source files must fit within the 250 MiB project limit.')
  if (mimeType === 'image/gif') {
    const gif = parseGIF(await blob.arrayBuffer())
    const duration = gif.frames.reduce((sum, frame) => 'image' in frame ? sum + Math.max(10, (frame.gce?.delay || 10) * 10) : sum, 0)
    return { kind: 'gif' as const, width: gif.lsd.width, height: gif.lsd.height, duration_ms: duration }
  }
  if (mimeType.startsWith('image/')) {
    const image = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const result = { kind: 'image' as const, width: image.width, height: image.height, duration_ms: 0 }
    image.close()
    if (result.width * result.height > 40_000_000)
      throw new Error('Still images can contain up to 40 megapixels.')
    return result
  }
  return new Promise<{ kind: 'video', width: number, height: number, duration_ms: number }>((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)
    let timeout: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timeout)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
    timeout = setTimeout(() => {
      finish()
      reject(new Error('Video metadata could not be read. Try an MP4 or WebM file supported by this browser.'))
    }, 15_000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const metadata = { kind: 'video' as const, width: video.videoWidth, height: video.videoHeight, duration_ms: Math.round(video.duration * 1000) }
      finish()
      if (!Number.isFinite(metadata.duration_ms) || metadata.duration_ms <= 0)
        reject(new Error('The video has no readable duration.'))
      else
        resolve(metadata)
    }
    video.onerror = () => {
      finish()
      reject(new Error('This browser cannot read the selected video. Use MP4 or WebM.'))
    }
    video.src = url
  })
}

export async function renderStillImage(blob: Blob, clip: MediaClip, output: MediaOutput, signal?: AbortSignal): Promise<ProcessedMedia> {
  assertMediaNotCancelled(signal)
  const image = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    if (image.width * image.height > 40_000_000)
      throw new Error('Still images can contain up to 40 megapixels.')
    const crop = clip.crop || { x: 0, y: 0, width: 1, height: 1 }
    const width = image.width * crop.width
    const height = image.height * crop.height
    const quarterTurn = clip.rotate === 90 || clip.rotate === 270
    const scale = Math.min(output.width / (quarterTurn ? height : width), output.height / (quarterTurn ? width : height))
    const canvas = mediaCanvas(output.width, output.height)
    const context = context2d(canvas)
    if (output.format === 'jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, output.width, output.height)
    }
    context.translate(output.width / 2, output.height / 2)
    context.rotate(clip.rotate * Math.PI / 180)
    context.scale(clip.flip_x ? -1 : 1, clip.flip_y ? -1 : 1)
    context.filter = `brightness(${1 + clip.brightness}) contrast(${clip.contrast}) saturate(${clip.grayscale ? 0 : clip.saturation})`
    context.drawImage(image, image.width * crop.x, image.height * crop.y, width, height, -width * scale / 2, -height * scale / 2, width * scale, height * scale)
    assertMediaNotCancelled(signal)
    const mimeType = `image/${output.format}`
    const exported = await canvasBlob(canvas, mimeType, output.quality)
    assertMediaNotCancelled(signal)
    return { blob: exported, mime_type: exported.type, filename: `image-edit.${output.format === 'jpeg' ? 'jpg' : output.format}`, width: output.width, height: output.height, duration_ms: 0 }
  }
  finally {
    image.close()
  }
}

export async function decodeGifFrames(blob: Blob, signal?: AbortSignal, progress?: (ratio: number) => void): Promise<DecodedGif> {
  assertMediaNotCancelled(signal)
  const gif = parseGIF(await blob.arrayBuffer())
  const frames = gif.frames.filter((frame): frame is Extract<typeof frame, { image: unknown }> => 'image' in frame)
  if (!frames.length || frames.length > 900 || gif.lsd.width * gif.lsd.height > 16_000_000)
    throw new Error('GIF frame editing supports up to 900 source frames and 16 megapixels per frame.')
  const original = mediaCanvas(gif.lsd.width, gif.lsd.height)
  const context = context2d(original)
  const dimensions = fitMediaDimensions(gif.lsd.width, gif.lsd.height, 720, 720)
  const scaled = mediaCanvas(dimensions.width, dimensions.height)
  const scaledContext = context2d(scaled)
  const decoded: DecodedGif = { ...dimensions, duration_ms: 0, frames: [] }
  let previous: ReturnType<typeof decompressFrame> | null = null
  let restore: ImageData | null = null

  for (let index = 0; index < frames.length; index++) {
    assertMediaNotCancelled(signal)
    if (previous?.disposalType === 2)
      context.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height)
    else if (previous?.disposalType === 3 && restore)
      context.putImageData(restore, 0, 0)
    const frame = decompressFrame(frames[index]!, gif.gct, true)
    restore = frame.disposalType === 3 ? context.getImageData(0, 0, original.width, original.height) : null
    const patch = mediaCanvas(frame.dims.width, frame.dims.height)
    context2d(patch).putImageData(new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height), 0, 0)
    context.drawImage(patch, frame.dims.left, frame.dims.top)
    scaledContext.clearRect(0, 0, scaled.width, scaled.height)
    scaledContext.drawImage(original, 0, 0, scaled.width, scaled.height)
    const delay = Math.max(10, frame.delay || 100)
    decoded.duration_ms += delay
    decoded.frames.push({ source_index: index, delay_ms: delay, blob: await canvasBlob(scaled) })
    previous = frame
    progress?.((index + 1) / frames.length)
    if (index % 5 === 0)
      await new Promise(resolve => setTimeout(resolve, 0))
  }
  return decoded
}
