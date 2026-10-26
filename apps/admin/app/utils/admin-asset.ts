export function adminAssetURL(asset: string): string {
  return `/admin/${asset.replace(/^\/+/, '')}`
}
