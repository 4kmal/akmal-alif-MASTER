import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initializeWorkspace } from './workspace.mjs';
import { openStore } from './store.mjs';
import { intakeTeam } from './intake.mjs';

const workspace = await initializeWorkspace();
const assignment = JSON.parse(await readFile(resolve(workspace, 'data/assignment.json'), 'utf8'));
const store = openStore(resolve(workspace, 'data/judging.sqlite'));
let failures = 0;
try {
  for (const team of assignment.teams) {
    try {
      const result = await intakeTeam({ workspace, team, store, refresh: process.argv.includes('--refresh'), report: message => console.log(`${team.name}: ${message}`) });
      console.log(`${team.name}: ${result.sha} (${result.evidenceIds.length} evidence records)`);
    } catch (error) { failures++; console.error(`${team.name}: ${error.message}`); }
  }
} finally { store.close(); }
process.exitCode = failures ? 1 : 0;
