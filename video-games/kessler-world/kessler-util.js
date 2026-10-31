/* Kessler IV Explorer: shared math and seeded noise helpers (no DOM, no THREE). */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const pad = (n, l = 2) => String(n).padStart(l, '0');
export const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

export function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function makeNoise(seed){
  const rand = mulberry32(seed);
  const perm = Array.from({length:256}, (_, i) => i);
  for (let i = 255; i > 0; i--){ const j = Math.floor(rand() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = [1,-1,1,-1,1,-1,0,0], gy = [1,1,-1,-1,0,0,1,-1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function(xin, yin){
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0){ g = p[ii + p[jj]] & 7; tt *= tt; n += tt * tt * (gx[g] * x0 + gy[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0){ g = p[ii + i1 + p[jj + j1]] & 7; tt *= tt; n += tt * tt * (gx[g] * x1 + gy[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0){ g = p[ii + 1 + p[jj + 1]] & 7; tt *= tt; n += tt * tt * (gx[g] * x2 + gy[g] * y2); }
    return 70 * n;
  };
}
export function fbm(n, x, y, oct = 5){ let a = 0.5, f = 1, s = 0, norm = 0; for (let i = 0; i < oct; i++){ s += a * n(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; } return s / norm; }
export function ridged(n, x, y, oct = 5){ let a = 0.5, f = 1, s = 0, norm = 0, w = 1; for (let i = 0; i < oct; i++){ let v = 1 - Math.abs(n(x * f, y * f)); v *= v; v *= w; w = clamp(v * 1.6, 0, 1); s += a * v; norm += a; a *= 0.5; f *= 2.1; } return s / norm; }
