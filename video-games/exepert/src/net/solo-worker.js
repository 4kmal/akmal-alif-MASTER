/* Solo play: the authoritative room runs in this worker and talks to the page with the same messages as the server. */
import { buildWorld } from '../../../kessler-world/world.js';
import { Room, DT } from '../../sim/room-core.js';

let world = null, room = null, me = null, last = 0, acc = 0, timer = null;

function loop(){
  const now = performance.now();
  acc += Math.min((now - last) / 1000, 0.25); last = now;
  let n = 0;
  while (acc >= DT && n++ < 5){ room.tick(DT); acc -= DT; }
}

self.onmessage = e => {
  const m = e.data;
  if (m && m.t === 'init'){
    world ||= buildWorld();
    room = new Room({world, solo:true, code:'SOLO', mode:m.mode, sector:m.sector, bots:m.bots, difficulty:m.difficulty, seed:(Math.random() * 4294967296) >>> 0,
      send:(pid, text) => self.postMessage(text)}); // solo has exactly one human, and join() sends its welcome before returning
    me = room.join({name:m.name, loadout:m.loadout});
    last = performance.now(); acc = 0;
    clearInterval(timer); timer = setInterval(loop, 1000 / 60);
    return;
  }
  if (room && me) room.handle(me.id, m);
};
