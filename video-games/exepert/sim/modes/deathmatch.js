/* Team Deathmatch and Free-for-all. Both are fought inside one sector of the Kessler map. */

export const tdm = {
  id:'tdm', name:'TEAM DEATHMATCH', short:'TDM', blurb:'Two crews, one sector. First to 75 eliminations.',
  teams:2, sector:'bastion', sectors:['bastion', 'ridgeback', 'silt'], maxPlayers:12, fill:8, scoreLimit:75, timeLimit:600, respawn:4,
  init(room){ room.ms = {score:[0, 0]}; },
  onKill(room, killer, victim){ if (killer && killer !== victim && killer.team !== victim.team) room.ms.score[killer.team]++; },
  tick(){},
  result(room){
    const [a, b] = room.ms.score, lim = room.scoreLimit;
    if (a >= lim || b >= lim) return {winner:a > b ? 0 : 1, reason:'SCORE LIMIT'};
    if (room.matchTime >= room.timeLimit) return {winner:a === b ? -1 : a > b ? 0 : 1, reason:'TIME'};
    return null;
  },
  hud(room){ return {s:room.ms.score, l:room.scoreLimit}; }
};

export const ffa = {
  id:'ffa', name:'FREE-FOR-ALL', short:'FFA', blurb:'Every runner for themselves. First to 30.',
  teams:0, sector:'bastion', sectors:['bastion', 'ridgeback', 'silt'], maxPlayers:10, fill:8, scoreLimit:30, timeLimit:540, respawn:3,
  init(room){ room.ms = {}; },
  onKill(){},
  tick(){},
  result(room){
    let best = null;
    for (const p of room.players.values()) if (!best || p.kills > best.kills) best = p;
    if (best && best.kills >= room.scoreLimit) return {winner:best.id, reason:'SCORE LIMIT'};
    if (room.matchTime >= room.timeLimit) return {winner:best ? best.id : -1, reason:'TIME'};
    return null;
  },
  hud(room){
    const top = [...room.players.values()].sort((a, b) => b.kills - a.kills).slice(0, 3).map(p => [p.id, p.kills]);
    return {top, l:room.scoreLimit};
  }
};
