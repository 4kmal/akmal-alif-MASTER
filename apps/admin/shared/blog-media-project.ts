export const BLOG_MEDIA_SOURCE_LIMIT = 250 * 1024 * 1024
export const BLOG_VIDEO_DURATION_LIMIT = 300_000
export const BLOG_GIF_DURATION_LIMIT = 30_000

export type BlogMediaKind = 'image' | 'video' | 'gif'
export type BlogMediaFormat = 'png' | 'jpeg' | 'webp' | 'mp4' | 'webm' | 'gif'

export interface MediaCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface MediaClip {
  id: string
  asset_id: string
  in_ms: number
  out_ms: number
  rate: number
  volume: number
  muted: boolean
  rotate: 0 | 90 | 180 | 270
  flip_x: boolean
  flip_y: boolean
  crop: MediaCrop | null
  brightness: number
  contrast: number
  saturation: number
  grayscale: boolean
}

export interface GifFrameSelection {
  source_index: number
  delay_ms: number
  enabled: boolean
}

export interface MediaOutput {
  format: BlogMediaFormat
  width: number
  height: number
  fps: number
  quality: number
  loop: number
}

export interface BlogMediaProject {
  schema_version: 1
  kind: BlogMediaKind
  clips: MediaClip[]
  frames: GifFrameSelection[]
  output: MediaOutput
}

export interface MediaAssetMetadata {
  id: string
  name?: string
  mime_type?: string
  kind?: BlogMediaKind
  size?: number
  width?: number | null
  height?: number | null
  duration_ms?: number | null
}

export interface MediaProgress {
  stage: string
  ratio: number | null
  message: string
}

export interface ProcessedMedia {
  blob: Blob
  filename: string
  mime_type: string
  width: number
  height: number
  duration_ms: number
  poster?: Blob
}

export interface DecodedGifFrame {
  source_index: number
  delay_ms: number
  blob: Blob
}

export interface DecodedGif {
  width: number
  height: number
  duration_ms: number
  frames: DecodedGifFrame[]
}
