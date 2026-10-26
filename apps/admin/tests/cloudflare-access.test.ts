import { generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  normalizeCloudflareAccessIssuer,
  verifyCloudflareAccessToken,
} from '../server/utils/cloudflare-access'

const issuer = 'https://restless-moon-2787.cloudflareaccess.com'
const audience = 'admin-audience'

describe('cloudflare access verification', () => {
  it('normalizes the configured bare team domain', () => {
    expect(normalizeCloudflareAccessIssuer('restless-moon-2787.cloudflareaccess.com')).toBe(issuer)
    expect(normalizeCloudflareAccessIssuer('https://example.com')).toBe('')
  })

  it('accepts an owner app assertion and rejects expired, spoofed, and service assertions', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const getKey = async () => publicKey
    const owner = await new SignJWT({ type: 'app', email: 'iamaleep@gmail.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'owner' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('owner-subject')
      .setExpirationTime('5m')
      .sign(privateKey)
    const expired = await new SignJWT({ type: 'app', email: 'iamaleep@gmail.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'expired' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('owner-subject')
      .setExpirationTime('0s')
      .sign(privateKey)
    const service = await new SignJWT({ type: 'app', common_name: 'service-token' })
      .setProtectedHeader({ alg: 'RS256', kid: 'service' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('')
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyCloudflareAccessToken(owner, { issuer, audience }, getKey)).resolves.toEqual({
      kind: 'user',
      userID: 'owner-subject',
      userEmail: 'iamaleep@gmail.com',
    })
    await expect(verifyCloudflareAccessToken(expired, { issuer, audience }, getKey)).resolves.toBeNull()
    await expect(verifyCloudflareAccessToken(owner, { issuer, audience: 'spoofed-audience' }, getKey)).resolves.toBeNull()
    await expect(verifyCloudflareAccessToken(service, { issuer, audience }, getKey)).resolves.toEqual({ kind: 'service' })
  })
})
