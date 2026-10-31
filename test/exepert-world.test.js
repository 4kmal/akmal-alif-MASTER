import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorld, PLACEMENT, SECTORS } from '../video-games/kessler-world/world.js';
import { CollisionWorld } from '../video-games/kessler-world/collide.js';

const world = buildWorld();

test('the stitched Kessler world builds deterministically', () => {
  const again = buildWorld();
  assert.equal(again.hash, world.hash);
  assert.equal(again.collide.items.length, world.collide.items.length);
  assert.equal(again.spawns.length, world.spawns.length);
});

test('visual buffers do not change the world layout', () => {
  const visual = buildWorld({ visual: true });
  assert.equal(visual.hash, world.hash);
  assert.ok(visual.lines.L.p.length > 0);
  assert.ok(visual.lines.F.p.length > 0);
});

test('every zone keeps its districts and stays inside sensible heights', () => {
  assert.deepEqual(world.zones.map((zone) => zone.id), ['bastion', 'ridgeback', 'silt']);
  const bastion = world.zones.find((zone) => zone.id === 'bastion');
  assert.equal(bastion.structures, 132, 'Bastion matches the explorer layout');
  assert.equal(bastion.regions.length, 6);
  for (const zone of world.zones) {
    const centre = PLACEMENT[zone.id];
    const h = world.ground(centre.x, centre.z);
    assert.ok(h >= 0 && h < 45, `${zone.id} centre height ${h}`);
  }
  assert.ok(world.maxH < 60);
});

test('water only floods the Silt Basin lowland', () => {
  for (const id of ['bastion', 'ridgeback']) {
    const { x, z } = PLACEMENT[id];
    let wet = 0;
    for (let a = 0; a < 360; a += 10) {
      for (let r = 0; r < 75; r += 5) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (world.waterAt(px, pz) > world.ground(px, pz)) wet += 1;
      }
    }
    assert.equal(wet, 0, `${id} has no standing water`);
  }
  const silt = PLACEMENT.silt;
  assert.ok(world.waterAt(silt.x, silt.z) > 0);
});

test('structures are solid for rays and players', () => {
  assert.ok(world.collide.items.length > 200);
  const spire = world.zones[0].regions.find((region) => region.name === 'COMMAND SPIRE');
  const hit = world.collide.raycast(spire.x - 60, spire.y + 10, spire.z, 1, 0, 0, 200);
  assert.ok(hit, 'a ray toward the Command Spire hits something');
  assert.notEqual(hit.kind, 'terrain');
  assert.ok(hit.x < spire.x && hit.x > spire.x - 60);
  assert.equal(world.collide.clear(spire.x - 60, spire.y + 10, spire.z, spire.x + 60, spire.y + 10, spire.z), false);
});

test('a player cylinder cannot sit inside a box', () => {
  const cw = new CollisionWorld({ ground: () => 0, bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 } });
  cw.addBox({ x: 0, z: 0, w: 4, d: 4, rot: 0.5, y0: -1, y1: 3 });
  cw.finalize();
  const push = cw.pushOut(0.5, 0, 0.2, 0.4, 1.8);
  const x = 0.5 + push.dx;
  const z = 0.2 + push.dz;
  assert.ok(!cw.blocked(x, 0, z, 0.39, 1.8), 'pushed clear of the box');
  assert.equal(cw.supportAt(0, 0, 3).y, 3, 'the roof is standable from just below it');
  assert.equal(cw.supportAt(0, 0, 0).y, 0, 'the roof is not a step from the ground');
});

test('bots have one large connected navigation network', () => {
  const seen = new Int32Array(world.nav.nodes.length).fill(-1);
  let largest = 0;
  for (const node of world.nav.nodes) {
    if (seen[node.id] >= 0) continue;
    const queue = [node.id];
    seen[node.id] = 1;
    let size = 0;
    while (queue.length) {
      const id = queue.pop();
      size += 1;
      for (const [next] of world.nav.nodes[id].edges) {
        if (seen[next] < 0) { seen[next] = 1; queue.push(next); }
      }
    }
    largest = Math.max(largest, size);
  }
  assert.ok(largest > world.nav.nodes.length * 0.85, `largest component ${largest}/${world.nav.nodes.length}`);
});

test('sectors cover their zone centres', () => {
  for (const id of ['bastion', 'ridgeback', 'silt']) {
    assert.ok(world.inSector(id, SECTORS[id].x, SECTORS[id].z));
  }
  assert.equal(world.inSector('bastion', PLACEMENT.ridgeback.x, PLACEMENT.ridgeback.z), false);
});
