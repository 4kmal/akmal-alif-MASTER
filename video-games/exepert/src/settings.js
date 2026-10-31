/* Player settings and identity, kept in localStorage (per browser). */
const KEY = 'exepert-settings';
const DEFAULTS = {
  callsign:'', sens:1, fov:90, vol:0.7, quality:'medium', invertY:false, toggleSprint:false,
  loadout:['breach', 'scatter'], mode:'tdm', sector:'bastion', difficulty:'normal', bots:'auto'
};

function load(){
  try { return {...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}')}; } catch { return {...DEFAULTS}; }
}

export const settings = load();

export function saveSettings(){
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
}

/* Stable per-browser token so a dropped connection can resume its slot. */
export function resumeToken(){
  try {
    let t = sessionStorage.getItem('exepert-token');
    if (!t){ t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('exepert-token', t); }
    return t;
  } catch { return null; }
}
