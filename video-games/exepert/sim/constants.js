/* EXEPERT shared rules: numbers both the browser and the game server must agree on.
   No DOM and no THREE in sim/. */
export const PROTOCOL = 1;
export const TICK_HZ = 20;
export const SNAP_HZ = 20;
export const INTERP_MS = 100;
export const MAX_REWIND_MS = 200;

export const PLAYER = {
  radius:0.42, height:1.8, crouchHeight:1.15, eye:1.62, crouchEye:1.0,
  hp:100, regenDelay:4, regenRate:25, spawnShield:1.5, respawn:4
};

export const MOVE = {
  walk:5.0, sprint:7.6, crouch:2.6, ads:3.3, water:0.6,
  accelGround:12, accelAir:2.4, friction:9,
  gravity:18, jump:6.4, doubleJump:5.8, coyote:0.12, stepUp:0.55,
  slideBoost:10.8, slideMin:4.2, slideTime:1.15, slideFriction:3.2,
  wallMinSpeed:4.8, wallGravity:3.2, wallTime:1.8, wallJumpOut:5.6, wallJumpUp:6.2, wallReattach:0.45,
  mantleMax:1.95, mantleMin:0.5, mantleTime:0.3,
  dashSpeed:32, dashTime:0.25, dashCooldown:7,
  maxSlope:0.66
};

/* Buttons held (b) and pressed-this-frame edges (e) in an input frame. */
export const BTN = { JUMP:1, CROUCH:2, SPRINT:4, DASH:8, FIRE:16, ADS:32, RELOAD:64, NADE:128, USE:256 };

export const TEAMS = [
  { id:0, name:'VANGUARD', short:'VAN', color:'#2ad4ff' },
  { id:1, name:'SYNDICATE', short:'SYN', color:'#ff2a8a' }
];
export const CREWS = [
  { name:'CREW AZURE', color:'#2ad4ff' }, { name:'CREW ROSE', color:'#ff2a8a' },
  { name:'CREW LIME', color:'#d4ff3a' }, { name:'CREW AMBER', color:'#ffb02a' }
];
export const SENTINEL_TEAM = 90;
export const SENTINEL_COLOR = '#ff4466';

/* Display name and colour of a team in any mode (two sides, crews, or sentinels). */
export function teamInfo(team, mode){
  if (team === SENTINEL_TEAM) return { name:'SENTINELS', color:SENTINEL_COLOR };
  if (mode && mode.teams > 2) return CREWS[team] || { name:`CREW ${team + 1}`, color:'#e6edf7' };
  return TEAMS[team] || { name:'', color:'#e6edf7' };
}
export const FFA_COLORS = ['#2ad4ff', '#ff2a8a', '#d4ff3a', '#ffb02a', '#b07bff', '#3affc4', '#ff5a3a', '#f4f4ff', '#6a8cff', '#ff7ad9', '#9aff3a', '#3ad1ff'];

export const BOT_NAMES = [
  'KESTREL', 'VANTA', 'HALCYON', 'RIGGER', 'NULLSET', 'OBELUS', 'SABLE', 'TALLOW', 'CINDER', 'MIRAGE',
  'BRINE', 'GANTRY', 'QUILL', 'SPECTRA', 'HOLLOW', 'DATUM', 'RELAY', 'PIVOT', 'ONYX', 'WICKER', 'FLUX', 'ARGENT'
];

export function sanitizeName(raw){
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9 _\-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 2 ? s : '';
}
