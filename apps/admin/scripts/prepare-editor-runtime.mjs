import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(appRoot, '.editor-runtime/editor-runtime/ffmpeg/0.12.10')
const files = [
  ['ffmpeg-core.js', fileURLToPath(import.meta.resolve('@ffmpeg/core'))],
  ['ffmpeg-core.wasm', fileURLToPath(import.meta.resolve('@ffmpeg/core/wasm'))],
]
const packageJson = JSON.parse(await readFile(resolve(dirname(files[0][1]), '../../package.json'), 'utf8'))
if (packageJson.version !== '0.12.10')
  throw new Error('The editor runtime must use @ffmpeg/core 0.12.10.')

await mkdir(outputRoot, { recursive: true })
const manifest = { version: packageJson.version, license: packageJson.license, source: 'https://github.com/ffmpegwasm/ffmpeg.wasm', objects: [] }
for (const [name, source] of files) {
  const bytes = await readFile(source)
  await writeFile(resolve(outputRoot, name), bytes)
  manifest.objects.push({ key: `editor-runtime/ffmpeg/0.12.10/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`${outputRoot}\n${manifest.objects.map(object => `${object.key} (${object.bytes} bytes, SHA-256 ${object.sha256})`).join('\n')}\n`)
