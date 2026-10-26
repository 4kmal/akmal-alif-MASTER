/**
 * Browser admin sessions use Cloudflare Access or the explicit local owner
 * bypass. The legacy Sink site token never belongs in browser storage.
 */
export function getAuthToken(): null {
  return null
}

export function setAuthToken(_token: string): void {
  // Kept as a no-op for old call sites while the owner boundary migrates away
  // from the legacy browser token flow.
}

export function removeAuthToken(): void {
  // No browser token is persisted or removed.
}
