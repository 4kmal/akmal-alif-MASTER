import type { FFmpeg } from '@ffmpeg/ffmpeg'
import type { BlogMediaProject, DecodedGif, MediaProgress, ProcessedMedia } from '../../../shared/blog-media-project'
import { BLOG_MEDIA_SOURCE_LIMIT } from '../../../shared/blog-media-project'
import { assertMediaNotCancelled, decodeGifFrames, inspectMedia, renderStillImage } from './image'
import { createMediaClip, createMediaProject, mediaProjectDuration, validateMediaProject, videoFilter } from './project'

export { createMediaClip, createMediaProject, inspectMedia, mediaProjectDuration, validateMediaProject }
export type { BlogMediaProject, DecodedGif, MediaProgress, ProcessedMedia }

interface ProcessorOptions {
  resolveAsset: (assetId: string, signal: AbortSignal) => Promise<Blob>
  onProgress?: (progress: MediaProgress) => void
  runtimeBase?: string
}

interface ProbeStream { codec_type: string, width?: number, height?: number }
interface ProbeResult { streams?: ProbeStream[], format?: { duration?: string } }

function sourceExtension(blob: Blob) {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm', 'video/mp4': 'mp4' } as Record<string, string>)[blob.type] || 'bin'
}

function binaryBlob(data: Uint8Array | string, type: string) {
  if (typeof data === 'string')
    throw new Error('The media processor returned text instead of a file.')
  return new Blob([new Uint8Array(data).buffer], { type })
}

function gifLoop(plays: number) {
  return plays === 0 ? 0 : plays === 1 ? -1 : plays - 1
}

export function createBlogMediaProcessor(options: ProcessorOptions) {
  let engine: FFmpeg | null = null
  let controller: AbortController | null = null
  let disposed = false
  let busy = false
  let sequence = 0
  let logTail = ''
  let progressWindow = { base: 0, span: 1, duration_ms: 0 }
  const gifs = new Map<string, DecodedGif>()
  const sourceFiles = new Map<string, Blob>()

  function report(stage: string, ratio: number | null, message: string) {
    options.onProgress?.({ stage, ratio: ratio === null ? null : Math.min(1, Math.max(0, ratio)), message })
  }

  async function source(id: string, signal: AbortSignal) {
    assertMediaNotCancelled(signal)
    let blob = sourceFiles.get(id)
    if (!blob) {
      blob = await options.resolveAsset(id, signal)
      if (!(blob instanceof Blob) || !blob.size)
        throw new Error('A source media file is empty or unavailable.')
      sourceFiles.set(id, blob)
    }
    if ([...sourceFiles.values()].reduce((sum, file) => sum + file.size, 0) > BLOG_MEDIA_SOURCE_LIMIT)
      throw new Error('A media project can contain up to 250 MiB of source files.')
    assertMediaNotCancelled(signal)
    return blob
  }

  async function load(signal: AbortSignal) {
    if (engine?.loaded)
      return engine
    report('loading', null, 'Loading the private browser media processor…')
    const { FFmpeg: FFmpegClass } = await import('@ffmpeg/ffmpeg')
    assertMediaNotCancelled(signal)
    const next = new FFmpegClass()
    engine = next
    next.on('log', ({ message }) => {
      logTail = `${logTail}\n${message}`.slice(-4000)
    })
    next.on('progress', ({ time }) => {
      const ratio = progressWindow.duration_ms > 0 ? time / 1000 / progressWindow.duration_ms : null
      report('rendering', ratio === null ? null : progressWindow.base + Math.min(1, Math.max(0, ratio)) * progressWindow.span, 'Rendering locally; keep this tab open.')
    })
    const runtime = options.runtimeBase || '/api/admin/blog/runtime'
    await next.load({ coreURL: `${runtime}/ffmpeg-core.js`, wasmURL: `${runtime}/ffmpeg-core.wasm` }, { signal })
    assertMediaNotCancelled(signal)
    return next
  }

  async function run(args: string[], signal: AbortSignal) {
    const ffmpeg = await load(signal)
    logTail = ''
    let code: number
    try {
      code = await ffmpeg.exec(args, -1, { signal })
    }
    catch (error) {
      assertMediaNotCancelled(signal)
      throw Object.assign(new Error('The processor could not finish this export. Your source files are preserved.'), { details: `${args.join(' ')}\n${String(error)}\n${logTail}` })
    }
    assertMediaNotCancelled(signal)
    if (code !== 0) {
      console.error('Media export failed', logTail)
      throw Object.assign(new Error('The processor could not export these clips. Check their formats and export settings, then retry.'), { details: logTail })
    }
  }

  async function write(path: string, blob: Blob, signal: AbortSignal) {
    const ffmpeg = await load(signal)
    await ffmpeg.writeFile(path, new Uint8Array(await blob.arrayBuffer()), { signal })
  }

  async function probe(path: string, signal: AbortSignal): Promise<ProbeResult> {
    const ffmpeg = await load(signal)
    const file = `probe_${++sequence}.json`
    logTail = ''
    const code = await ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path, '-o', file], -1, { signal })
    // Core 0.12.10 reports -1 even for a successful ffprobe (#817 upstream).
    // Accept that code only when a complete, usable JSON report was written.
    if (code !== 0 && code !== -1) {
      console.error('Media source probe failed', logTail)
      throw new Error('The selected source format could not be decoded.')
    }
    const result = await ffmpeg.readFile(file, 'utf8', { signal })
    await ffmpeg.deleteFile(file)
    const metadata: ProbeResult = JSON.parse(String(result))
    if (!metadata.streams?.some(stream => stream.codec_type === 'video' && Number(stream.width) > 0 && Number(stream.height) > 0))
      throw new Error('The source has no readable video or image stream.')
    return metadata
  }

  async function job<T>(operation: (signal: AbortSignal, prefix: string) => Promise<T>): Promise<T> {
    if (disposed)
      throw new Error('This media editor has been closed.')
    if (busy)
      throw new Error('Another media operation is running. Finish or cancel it first.')
    busy = true
    controller = new AbortController()
    const signal = controller.signal
    try {
      const result = await operation(signal, `media_${++sequence}`)
      assertMediaNotCancelled(signal)
      report('complete', 1, 'Export ready. The original media is unchanged.')
      return result
    }
    catch (error) {
      if (signal.aborted) {
        report('cancelled', null, 'Cancelled. Your source files and draft are preserved.')
        throw new DOMException('Media processing was cancelled.', 'AbortError')
      }
      report('error', null, error instanceof Error ? error.message : 'Media processing failed.')
      throw error
    }
    finally {
      engine?.terminate()
      engine = null
      sourceFiles.clear()
      controller = null
      busy = false
    }
  }

  async function gifSource(assetId: string, signal: AbortSignal) {
    const cached = gifs.get(assetId)
    if (cached)
      return cached
    const blob = await source(assetId, signal)
    report('decoding', 0, 'Decoding GIF frames…')
    const decoded = await decodeGifFrames(blob, signal, ratio => report('decoding', ratio, 'Decoding GIF frames…'))
    gifs.clear()
    gifs.set(assetId, decoded)
    return decoded
  }

  async function gifRender(project: BlogMediaProject, signal: AbortSignal, prefix: string): Promise<ProcessedMedia> {
    const clip = project.clips[0]!
    const decoded = await gifSource(clip.asset_id, signal)
    const selected = project.frames.length
      ? project.frames.filter(frame => frame.enabled)
      : decoded.frames.map(frame => ({ source_index: frame.source_index, delay_ms: frame.delay_ms, enabled: true }))
    const effective = { ...project, frames: selected }
    validateMediaProject(effective)
    if (!selected.length)
      throw new Error('Select at least one GIF frame.')
    const ffmpeg = await load(signal)
    const lines: string[] = []
    let first: Blob | undefined
    for (let index = 0; index < selected.length; index++) {
      const selection = selected[index]!
      const frame = decoded.frames[selection.source_index]
      if (!frame)
        throw new Error('A selected GIF frame no longer exists. Reload the source frames.')
      const rendered = await renderStillImage(frame.blob, clip, { ...project.output, format: 'png' }, signal)
      first ||= rendered.blob
      const path = `${prefix}_frame_${index}.png`
      await write(path, rendered.blob, signal)
      lines.push(`file '${path}'`, `duration ${selection.delay_ms / 1000}`)
      if (index === selected.length - 1)
        lines.push(`file '${path}'`)
      report('frames', (index + 1) / selected.length * 0.4, 'Applying frame edits…')
    }
    const list = `${prefix}_frames.txt`
    await ffmpeg.writeFile(list, lines.join('\n'))
    const duration = mediaProjectDuration(effective)
    const output = `${prefix}.${project.output.format}`
    progressWindow = { base: 0.4, span: 0.55, duration_ms: duration }
    if (project.output.format === 'gif') {
      const palette = `${prefix}_palette.png`
      await run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${project.output.fps},palettegen=stats_mode=diff`, '-frames:v', '1', palette], signal)
      await run(['-f', 'concat', '-safe', '0', '-i', list, '-i', palette, '-lavfi', `fps=${project.output.fps}[frames];[frames][1:v]paletteuse=dither=bayer:bayer_scale=3`, '-t', String(duration / 1000), '-loop', String(gifLoop(project.output.loop)), output], signal)
    }
    else {
      const codec = project.output.format === 'webm'
        ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '4', '-crf', String(Math.round(40 - project.output.quality * 30)), '-b:v', '4M']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-movflags', '+faststart']
      await run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${project.output.fps},format=yuv420p`, '-t', String(duration / 1000), ...codec, '-threads', '1', output], signal)
    }
    const mimeType = project.output.format === 'gif' ? 'image/gif' : `video/${project.output.format}`
    const blob = binaryBlob(await ffmpeg.readFile(output), mimeType)
    return { blob, mime_type: mimeType, filename: `gif-edit.${project.output.format}`, width: project.output.width, height: project.output.height, duration_ms: duration, poster: first }
  }

  async function videoRender(project: BlogMediaProject, signal: AbortSignal, prefix: string): Promise<ProcessedMedia> {
    const blobs = new Map<string, Blob>()
    for (const clip of project.clips)
      blobs.set(clip.asset_id, await source(clip.asset_id, signal))
    validateMediaProject(project, [...blobs].map(([id, blob]) => ({ id, size: blob.size })))
    const reports = new Map<string, ProbeResult>()
    for (const [id, blob] of blobs) {
      const path = `${prefix}_probe.${sourceExtension(blob)}`
      await write(path, blob, signal)
      reports.set(id, await probe(path, signal))
      // ffprobe and ffmpeg share native globals in this core. Keep probing in
      // disposable instances so a probe cannot corrupt a later encoder run.
      engine?.terminate()
      engine = null
    }
    const ffmpeg = await load(signal)
    const webm = project.output.format === 'webm'
    const segments: string[] = []
    for (let index = 0; index < project.clips.length; index++) {
      const clip = project.clips[index]!
      const blob = blobs.get(clip.asset_id)!
      const input = `${prefix}_input_${index}.${sourceExtension(blob)}`
      await write(input, blob, signal)
      const metadata = reports.get(clip.asset_id)!
      const sourceDuration = Number(metadata.format?.duration) * 1000
      if (Number.isFinite(sourceDuration) && clip.out_ms > sourceDuration + 100)
        throw new Error(`Clip ${index + 1} ends after its source media.`)
      const hasAudio = metadata.streams?.some(stream => stream.codec_type === 'audio') || false
      const still = blob.type.startsWith('image/') && blob.type !== 'image/gif'
      const sourceTime = (clip.out_ms - clip.in_ms) / 1000
      const outputTime = sourceTime / clip.rate
      const segment = `${prefix}_clip_${index}.mkv`
      const codec = webm
        ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '4', '-crf', String(Math.round(40 - project.output.quality * 30)), '-b:v', '4M']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(Math.round(36 - project.output.quality * 16))]
      progressWindow = { base: index / project.clips.length * 0.8, span: 0.8 / project.clips.length, duration_ms: outputTime * 1000 }
      await run([
        ...(still ? ['-loop', '1'] : []),
        '-ss',
        String(clip.in_ms / 1000),
        '-t',
        String(sourceTime),
        '-i',
        input,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map',
        '0:v:0',
        '-map',
        hasAudio && !clip.muted ? '0:a:0' : '1:a:0',
        '-vf',
        videoFilter(clip, project.output),
        '-af',
        `atrim=duration=${sourceTime},asetpts=PTS-STARTPTS,atempo=${clip.rate},volume=${clip.muted ? 0 : clip.volume}`,
        '-t',
        String(outputTime),
        ...codec,
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'pcm_s16le',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-threads',
        '1',
        segment,
      ], signal)
      await ffmpeg.deleteFile(input)
      segments.push(segment)
    }
    const list = `${prefix}_clips.txt`
    await ffmpeg.writeFile(list, segments.map(path => `file '${path}'`).join('\n'))
    const joined = `${prefix}_joined.${webm ? 'webm' : 'mp4'}`
    const duration = mediaProjectDuration(project)
    progressWindow = { base: 0.8, span: 0.1, duration_ms: duration }
    await run(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', '-c:a', webm ? 'libvorbis' : 'aac', '-b:a', '128k', '-t', String(duration / 1000), ...(!webm ? ['-movflags', '+faststart'] : []), joined], signal)
    const posterFile = `${prefix}_poster.png`
    await run(['-i', joined, '-frames:v', '1', posterFile], signal)
    const poster = binaryBlob(await ffmpeg.readFile(posterFile), 'image/png')
    let output = joined
    if (project.output.format === 'gif') {
      const palette = `${prefix}_palette.png`
      output = `${prefix}.gif`
      await run(['-i', joined, '-vf', 'palettegen=stats_mode=diff', '-frames:v', '1', palette], signal)
      await run(['-i', joined, '-i', palette, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3', '-loop', String(gifLoop(project.output.loop)), output], signal)
    }
    const mimeType = project.output.format === 'gif' ? 'image/gif' : `video/${project.output.format}`
    return { blob: binaryBlob(await ffmpeg.readFile(output), mimeType), mime_type: mimeType, filename: `video-edit.${project.output.format}`, width: project.output.width, height: project.output.height, duration_ms: duration, poster }
  }

  return {
    render(project: BlogMediaProject) {
      return job(async (signal, prefix) => {
        validateMediaProject(project)
        if (project.kind === 'image') {
          report('image', null, 'Applying image adjustments…')
          return renderStillImage(await source(project.clips[0]!.asset_id, signal), project.clips[0]!, project.output, signal)
        }
        return project.kind === 'gif' ? gifRender(project, signal, prefix) : videoRender(project, signal, prefix)
      })
    },
    decodeGif(assetId: string) {
      return job(signal => gifSource(assetId, signal))
    },
    poster(assetId: string, timeMs = 0) {
      return job(async (signal, prefix) => {
        const blob = await source(assetId, signal)
        if (blob.type === 'image/gif')
          return (await gifSource(assetId, signal)).frames[0]!.blob
        if (blob.type.startsWith('image/')) {
          const metadata = await inspectMedia(blob)
          const project = createMediaProject('image', { id: assetId, ...metadata })
          return (await renderStillImage(blob, project.clips[0]!, project.output, signal)).blob
        }
        const ffmpeg = await load(signal)
        const input = `${prefix}_poster_source.${sourceExtension(blob)}`
        const output = `${prefix}_poster.png`
        await write(input, blob, signal)
        await run(['-ss', String(Math.max(0, timeMs) / 1000), '-i', input, '-frames:v', '1', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease', output], signal)
        return binaryBlob(await ffmpeg.readFile(output), 'image/png')
      })
    },
    cancel() {
      controller?.abort()
      engine?.terminate()
      engine = null
    },
    dispose() {
      disposed = true
      controller?.abort()
      engine?.terminate()
      engine = null
      gifs.clear()
      sourceFiles.clear()
    },
  }
}
