import type { BlogMediaKind, BlogMediaProject, MediaAssetMetadata, MediaClip, MediaOutput } from '../../../shared/blog-media-project'
import { BLOG_GIF_DURATION_LIMIT, BLOG_MEDIA_SOURCE_LIMIT, BLOG_VIDEO_DURATION_LIMIT } from '../../../shared/blog-media-project'

const formats = {
  image: new Set(['png', 'jpeg', 'webp']),
  video: new Set(['mp4', 'webm', 'gif']),
  gif: new Set(['gif', 'mp4', 'webm']),
}

export function fitMediaDimensions(width: number, height: number, maxWidth: number, maxHeight: number, even = false) {
  const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height))
  const unit = even ? 2 : 1
  return {
    width: Math.max(unit, Math.floor(width * scale / unit) * unit),
    height: Math.max(unit, Math.floor(height * scale / unit) * unit),
  }
}

export function createMediaClip(asset: MediaAssetMetadata): MediaClip {
  return {
    id: crypto.randomUUID(),
    asset_id: asset.id,
    in_ms: 0,
    out_ms: Math.max(1, Number(asset.duration_ms) || 3000),
    rate: 1,
    volume: 1,
    muted: false,
    rotate: 0,
    flip_x: false,
    flip_y: false,
    crop: null,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    grayscale: false,
  }
}

export function createMediaProject(kind: BlogMediaKind, asset: MediaAssetMetadata): BlogMediaProject {
  const sourceWidth = Number(asset.width) || 1280
  const sourceHeight = Number(asset.height) || 720
  const dimensions = kind === 'gif'
    ? fitMediaDimensions(sourceWidth, sourceHeight, 720, 720, true)
    : fitMediaDimensions(sourceWidth, sourceHeight, kind === 'image' ? 4096 : 1920, kind === 'image' ? 4096 : 1080, kind !== 'image')
  return {
    schema_version: 1,
    kind,
    clips: [createMediaClip(asset)],
    frames: [],
    output: {
      format: kind === 'image' ? 'png' : kind === 'gif' ? 'gif' : 'mp4',
      ...dimensions,
      fps: kind === 'gif' ? 15 : 30,
      quality: 0.9,
      loop: 1,
    },
  }
}

export function mediaProjectDuration(project: BlogMediaProject) {
  if (project.kind === 'image')
    return 0
  if (project.kind === 'gif' && project.frames.length)
    return project.frames.filter(frame => frame.enabled).reduce((sum, frame) => sum + frame.delay_ms, 0)
  return project.clips.reduce((sum, clip) => sum + (clip.out_ms - clip.in_ms) / clip.rate, 0)
}

function numberIn(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function validateMediaProject(project: BlogMediaProject, assets: MediaAssetMetadata[] = []) {
  if (project?.schema_version !== 1 || !Object.hasOwn(formats, project.kind))
    throw new Error('This media project version is not supported.')
  if (!Array.isArray(project.clips) || !project.clips.length || project.clips.length > 30)
    throw new Error('A project needs between one and thirty clips.')
  if (project.kind !== 'video' && project.clips.length !== 1)
    throw new Error('Image and GIF projects use one source asset.')
  const output = project.output
  if (!output || !formats[project.kind].has(output.format))
    throw new Error('Choose an export format supported by this project.')
  const gif = output.format === 'gif'
  const maxWidth = gif ? 720 : project.kind === 'image' ? 4096 : 1920
  const maxHeight = gif ? 720 : project.kind === 'image' ? 4096 : 1080
  if (!Number.isInteger(output.width) || !Number.isInteger(output.height)
    || !numberIn(output.width, 1, maxWidth) || !numberIn(output.height, 1, maxHeight)) {
    throw new Error(`Export dimensions must fit within ${maxWidth} × ${maxHeight}.`)
  }
  if (['mp4', 'webm'].includes(output.format) && (output.width % 2 || output.height % 2))
    throw new Error('Video export width and height must be even numbers.')
  if (!numberIn(output.fps, 1, gif ? 15 : 30) || !numberIn(output.quality, 0.1, 1)
    || !Number.isInteger(output.loop) || !numberIn(output.loop, 0, 100)) {
    throw new Error('Export frame rate, quality or loop count is invalid.')
  }
  for (const clip of project.clips) {
    if (!clip.asset_id || typeof clip.asset_id !== 'string' || clip.asset_id.length > 128)
      throw new Error('Every clip needs a source asset.')
    if (![clip.muted, clip.flip_x, clip.flip_y, clip.grayscale].every(value => typeof value === 'boolean'))
      throw new Error('Clip switches must be true or false.')
    if (!numberIn(clip.in_ms, 0, Number.MAX_SAFE_INTEGER) || !numberIn(clip.out_ms, 0, Number.MAX_SAFE_INTEGER)
      || (project.kind !== 'image' && clip.out_ms <= clip.in_ms)
      || !numberIn(clip.rate, 0.5, 2) || !numberIn(clip.volume, 0, 2)
      || ![0, 90, 180, 270].includes(clip.rotate)
      || !numberIn(clip.brightness, -1, 1) || !numberIn(clip.contrast, 0, 2)
      || !numberIn(clip.saturation, 0, 2)) {
      throw new Error('A clip contains invalid timing or adjustment values.')
    }
    if (clip.crop && (!numberIn(clip.crop.x, 0, 1) || !numberIn(clip.crop.y, 0, 1)
      || !numberIn(clip.crop.width, 0.001, 1) || !numberIn(clip.crop.height, 0.001, 1)
      || clip.crop.x + clip.crop.width > 1.000001 || clip.crop.y + clip.crop.height > 1.000001)) {
      throw new Error('The crop must stay inside the source image.')
    }
    const asset = assets.find(item => item.id === clip.asset_id)
    if (asset?.duration_ms && clip.out_ms > asset.duration_ms + 100)
      throw new Error('A clip ends after its source media.')
  }
  const uniqueAssets = new Set(project.clips.map(clip => clip.asset_id))
  const bytes = assets.filter(asset => uniqueAssets.has(asset.id)).reduce((sum, asset) => sum + (asset.size || 0), 0)
  if (bytes > BLOG_MEDIA_SOURCE_LIMIT)
    throw new Error('A media project can contain up to 250 MiB of source files.')
  if (!Array.isArray(project.frames) || project.frames.length > 900
    || project.frames.some(frame => !Number.isInteger(frame.source_index) || frame.source_index < 0
      || !numberIn(frame.delay_ms, 10, BLOG_GIF_DURATION_LIMIT) || typeof frame.enabled !== 'boolean')) {
    throw new Error('GIF frame selections or delays are invalid.')
  }
  if (project.frames.length && !project.frames.some(frame => frame.enabled))
    throw new Error('Select at least one GIF frame to export.')
  const limit = gif || project.kind === 'gif' ? BLOG_GIF_DURATION_LIMIT : BLOG_VIDEO_DURATION_LIMIT
  if (mediaProjectDuration(project) > limit)
    throw new Error(gif || project.kind === 'gif' ? 'GIF projects can contain up to 30 seconds.' : 'Video projects can contain up to five minutes.')
  return project
}

export function videoFilter(clip: MediaClip, output: MediaOutput) {
  const filters: string[] = []
  if (clip.crop) {
    const { x, y, width, height } = clip.crop
    filters.push(`crop=iw*${width}:ih*${height}:iw*${x}:ih*${y}`)
  }
  if (clip.rotate === 90)
    filters.push('transpose=1')
  else if (clip.rotate === 180)
    filters.push('hflip', 'vflip')
  else if (clip.rotate === 270)
    filters.push('transpose=2')
  if (clip.flip_x)
    filters.push('hflip')
  if (clip.flip_y)
    filters.push('vflip')
  filters.push(`eq=brightness=${clip.brightness}:contrast=${clip.contrast}:saturation=${clip.grayscale ? 0 : clip.saturation}`)
  filters.push(`scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease`)
  filters.push(`pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2:color=black`)
  filters.push(`setsar=1,setpts=(PTS-STARTPTS)/${clip.rate},fps=${output.fps}`)
  return filters.join(',')
}
