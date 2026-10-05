// tools/run-tests.mjs — run the whole `test/**/*.test.js` suite ONE FILE PER PROCESS with inherited stdio.
//
// Why this exists: `node --test` starts a child process per test file with piped stdio, which some sandboxes refuse
// (spawn EPERM) even though the tests themselves run fine. This runner spawns each file with `stdio: 'inherit'` and
// tallies the files that failed, so the same suite can be run in a confined environment.
//
//   node tools/run-tests.mjs                 # every test/**/*.test.js
//   node tools/run-tests.mjs test/match      # only files under (or named like) the given paths
//   node tools/run-tests.mjs test/ui/bandDraft.test.js
//
// Opt-in suites (SP_E2E, SP_REAL_E2E, RENDER_E2E) behave as in `node --test`: they run a browser and are meant to be
// enabled explicitly; this runner passes the environment through unchanged.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every `*.test.js` under `dir`, sorted, skipping node_modules and the vendored client libs. */
export function collect(dir = path.join(ROOT, 'test')) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (e.name.endsWith('.test.js')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Turn file/dir arguments into the list of test files to run (`[]` ⇒ the whole test tree). */
export function select(args, list = collect()) {
  if (!args.length) return list;
  const wanted = args.map((a) => path.resolve(ROOT, a));
  return list.filter((f) => wanted.some((w) => f === w || f.startsWith(w + path.sep) || f.includes(path.sep + path.basename(w))));
}

/**
 * Run each file in its own process; returns `{ files, failed }` (failed = the file names that exited non-zero).
 * @param {string[]} files
 * @param {{ spawn?: typeof spawnSync }} [opts] injectable for tests
 */
export function runFiles(files, { spawn = spawnSync } = {}) {
  const failed = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    process.stdout.write(`\n=== ${rel} ===\n`);
    const r = spawn(process.execPath, [f], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) failed.push(rel);
  }
  return { files: files.map((f) => path.relative(ROOT, f).split(path.sep).join('/')), failed };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = select(process.argv.slice(2));
  if (!files.length) {
    console.error('no test files matched');
    process.exit(1);
  }
  const { failed } = runFiles(files);
  console.log(`\n${files.length - failed.length}/${files.length} files passed`);
  if (failed.length) {
    console.log('failed files:');
    for (const f of failed) console.log(`  ${f}`);
  }
  process.exit(failed.length ? 1 : 0);
}
