import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateWorkspaceUrl } from '../scripts/private-workspaces.mjs';

test('private judging evidence cannot be reached through frontend paths', () => {
  for (const path of ['/events/judging/sdcHackathon/repos/a/index.html', '/@fs/C:/xampp/htdocs/akmal-alif-MASTER/events/judging/x', '/events%2fjudging/x', '/events%252fjudging/x', '/repo-reference/sink/index.html', '/events\\judging/x']) {
    assert.equal(isPrivateWorkspaceUrl(path), true, path);
  }
  assert.equal(isPrivateWorkspaceUrl('/blogs'), false);
  assert.equal(isPrivateWorkspaceUrl('/assets/picture/pfp.webp'), false);
});
