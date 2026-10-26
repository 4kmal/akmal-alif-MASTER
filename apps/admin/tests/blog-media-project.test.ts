import { describe, expect, it } from 'vitest'
import { createMediaClip, createMediaProject, mediaProjectDuration, validateMediaProject } from '../app/utils/blog-media/project'

describe('media project limits and timelines', () => {
  const asset = { id: 'source', width: 3840, height: 2160, duration_ms: 120_000, size: 20_000 }
  it('fits 4K sources inside 1080p without upscaling small sources', () => {
    const project = createMediaProject('video', asset)
    expect(project.output).toMatchObject({ width: 1920, height: 1080, format: 'mp4' })
    expect(createMediaProject('video', { ...asset, width: 321, height: 241 }).output).toMatchObject({ width: 320, height: 240 })
    expect(validateMediaProject(project, [asset])).toBe(project)
  })
  it('counts joined output time after trimming and speed changes', () => {
    const project = createMediaProject('video', asset)
    project.clips[0] = { ...project.clips[0]!, in_ms: 10_000, out_ms: 70_000, rate: 2 }
    project.clips.push({ ...createMediaClip(asset), in_ms: 20_000, out_ms: 35_000, rate: 0.5 })
    expect(mediaProjectDuration(project)).toBe(60_000)
    expect(() => validateMediaProject(project, [asset])).not.toThrow()
    project.clips[1]!.out_ms = 200_000
    expect(() => validateMediaProject(project, [asset])).toThrow('after its source')
  })
  it('counts each source once while enforcing the combined 250 MiB budget', () => {
    const project = createMediaProject('video', asset)
    project.clips.push(createMediaClip(asset))
    expect(() => validateMediaProject(project, [{ ...asset, size: 200 * 1024 * 1024 }])).not.toThrow()
    project.clips.push(createMediaClip({ ...asset, id: 'second' }))
    expect(() => validateMediaProject(project, [{ ...asset, size: 200 * 1024 * 1024 }, { ...asset, id: 'second', size: 60 * 1024 * 1024 }])).toThrow('250 MiB')
  })
  it('rejects oversized or malformed exports before loading a processor', () => {
    const project = createMediaProject('video', asset)
    project.output.width = 1921
    expect(() => validateMediaProject(project)).toThrow('dimensions')
    project.output.width = 1919
    expect(() => validateMediaProject(project)).toThrow('even')
    project.output.width = 1920
    project.clips[0]!.out_ms = 300_001
    expect(() => validateMediaProject(project)).toThrow('five minutes')
    project.clips[0]!.out_ms = 1000
    project.clips[0]!.crop = { x: 0.8, y: 0, width: 0.5, height: 1 }
    expect(() => validateMediaProject(project)).toThrow('crop')
    project.clips[0]!.crop = null
    project.clips[0]!.muted = 'false' as unknown as boolean
    expect(() => validateMediaProject(project)).toThrow('switches')
    expect(() => validateMediaProject({ ...project, kind: 'constructor' } as never)).toThrow('not supported')
  })
  it('keeps selected GIF frame order and timing within the output cap', () => {
    const project = createMediaProject('gif', { ...asset, duration_ms: 1000 })
    project.frames = [{ source_index: 2, delay_ms: 200, enabled: true }, { source_index: 0, delay_ms: 300, enabled: true }, { source_index: 1, delay_ms: 900, enabled: false }]
    expect(mediaProjectDuration(project)).toBe(500)
    expect(() => validateMediaProject(project)).not.toThrow()
    project.frames[0]!.delay_ms = 30_000
    expect(() => validateMediaProject(project)).toThrow('30 seconds')
    project.frames = []
    project.output.fps = 16
    expect(() => validateMediaProject(project)).toThrow('frame rate')
    project.output.fps = 15
    project.output.width = 721
    expect(() => validateMediaProject(project)).toThrow('720')
  })
})
