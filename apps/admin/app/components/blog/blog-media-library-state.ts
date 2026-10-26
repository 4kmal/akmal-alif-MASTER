export interface BlogMediaSelectionToken {
  generation: number
  assetId: string | null
}

export function createBlogMediaSelectionGuard() {
  let generation = 0

  return {
    begin(assetId: string | null): BlogMediaSelectionToken {
      generation += 1
      return { generation, assetId }
    },
    isCurrent(token: BlogMediaSelectionToken, assetId: string | null) {
      return token.generation === generation && token.assetId === assetId
    },
  }
}

export function isValidBlogClipIndex(index: number, length: number) {
  return Number.isInteger(index) && index >= 0 && index < length
}

export function getBlogPosterAssets<T extends { kind: string }>(assets: readonly T[]) {
  return assets.filter(asset => asset.kind === 'image' || asset.kind === 'gif')
}
