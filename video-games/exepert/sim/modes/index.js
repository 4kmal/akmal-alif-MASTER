/* EXEPERT game modes. Each mode plugs rules into the room:
   init, onKill, tick, result, hud, plus optional spawn, deploy, snapshot and bot hints. */
import { tdm, ffa } from './deathmatch.js';
import { uplink } from './uplink.js';

export const MODES = { tdm, ffa, uplink };
export const MODE_IDS = Object.keys(MODES);

export function registerMode(mode){ MODES[mode.id] = mode; if (!MODE_IDS.includes(mode.id)) MODE_IDS.push(mode.id); }
export function getMode(id){ return MODES[id] || MODES.tdm; }
