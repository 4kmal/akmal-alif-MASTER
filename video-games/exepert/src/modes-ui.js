/* Per-mode HUD widgets: the objective strip at the top of the screen and extra chips on the right. */
import { TEAMS } from '../sim/constants.js';
import { esc, mmss } from './hud.js';

export const MODE_UI = {
  tdm:{
    objective(g, m, tl){
      const s = m.s || [0, 0], mine = g.myTeam;
      const cell = t => `<span class="team ${t === 0 ? 'van' : 'syn'}">${t === mine ? '◆ ' : ''}${s[t]}</span>`;
      return `${cell(0)}<span class="time">${mmss(tl)} · TO ${m.l}</span>${cell(1)}`;
    }
  },
  ffa:{
    objective(g, m, tl){
      const me = g.roster.get(g.myId), sorted = [...g.roster.values()].sort((a, b) => b.kills - a.kills);
      const rank = sorted.findIndex(r => r.id === g.myId) + 1, lead = sorted[0];
      return `<span class="team" style="color:var(--signal)">#${rank || '-'} · ${me ? me.kills : 0}</span><span class="time">${mmss(tl)} · TO ${m.l}</span><span class="team">${lead ? esc(lead.name) + ' ' + lead.kills : '-'}</span>`;
    }
  }
};

export function registerModeUI(id, ui){ MODE_UI[id] = ui; }
export const teamName = t => TEAMS[t]?.name || '';
