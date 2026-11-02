// The dev app with an empty data folder made for this run, so the saved connections and drafts of an installed
// pgsketch are not touched. Usage: node scripts/dev-tmp.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pgsketch-'));
const { status } = spawnSync('pnpm', ['--filter', '@pgsketch/desktop', 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, PGSKETCH_DATA_DIR: dataDir },
  // on Windows `pnpm` is a .cmd file, which only a shell can start
  shell: process.platform === 'win32',
});
process.exit(status ?? 1);
