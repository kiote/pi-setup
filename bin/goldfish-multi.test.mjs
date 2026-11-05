import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runReviews } from './goldfish-multi.mjs';

const fixture = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const get = key => args[args.indexOf(key) + 1];
const model = get('--model');
const report = get('--out');
fs.writeFileSync(report + '.start', String(Date.now()));
if (model === 'hang') {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
  fs.writeFileSync(report + '.pid', String(child.pid));
  setInterval(()=>{},1000);
} else setTimeout(() => {
  const blocker = model === 'fail' ? 1 : 0;
  const major = model === 'major' ? 1 : 0;
  if (model !== 'missing') fs.writeFileSync(report, model === 'bad' ? 'bad report' : 'Finding ' + model + '\\nCOUNTS: blocker=' + blocker + ' major=' + major + ' nit=0\\n');
  fs.writeFileSync(report + '.end', String(Date.now()));
  process.exit(model === 'error' ? 2 : model === 'mismatch' ? 1 : blocker || (major && get('--fail-on') === 'major') ? 1 : 0);
}, model === 'fail' ? 30 : 300);
`;
async function withFixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goldfish-multi-test-'));
  const target = path.join(dir, 'target with spaces.md');
  const checker = path.join(dir, 'fake checker.cjs');
  writeFileSync(target, '# Test');
  writeFileSync(checker, fixture);
  try { await fn({ target, checker, outDir: dir, timeout: 10, progress: () => {} }, dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('all three run concurrently and finish after an early failure', () => withFixture(async opt => {
  const r = await runReviews({ ...opt, models: ['fail', 'pass', 'major'] });
  assert.equal(r.code, 1);
  assert.deepEqual(r.results.map(x => x.code), [1, 0, 0]);
  const starts = r.results.map(x => +readFileSync(x.report + '.start'));
  const ends = r.results.map(x => +readFileSync(x.report + '.end'));
  // Slow lenses overlap; the fast failing lens did not stop either one.
  assert.ok(Math.max(starts[1], starts[2]) < Math.min(ends[1], ends[2]));
  const combined = readFileSync(r.report, 'utf8');
  for (const model of ['fail', 'pass', 'major']) assert.ok(combined.includes('Finding ' + model));
}));

test('success, unique output folders, and major threshold', () => withFixture(async opt => {
  const a = await runReviews({ ...opt, models: ['major'] });
  const b = await runReviews({ ...opt, models: ['major'], failOn: 'major' });
  assert.equal(a.code, 0);
  assert.equal(b.code, 1);
  assert.notEqual(a.report, b.report);
}));

test('errors override findings; malformed and missing reports cannot pass', () => withFixture(async opt => {
  const r = await runReviews({ ...opt, models: ['fail', 'error', 'bad', 'missing', 'mismatch'] });
  assert.equal(r.code, 2);
  assert.deepEqual(r.results.map(x => x.code), [1, 2, 2, 2, 2]);
  assert.ok(r.results.every(x => existsSync(x.log)));
}));

test('deadline stops checker and descendant on this platform', () => withFixture(async opt => {
  const r = await runReviews({ ...opt, models: ['hang'], timeout: 1 });
  assert.equal(r.code, 2);
  assert.match(r.results[0].error, /timeout/);
  const pid = +readFileSync(r.results[0].report + '.pid');
  assert.throws(() => process.kill(pid, 0));
}));

test('abort stops all running lenses', () => withFixture(async opt => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const r = await runReviews({ ...opt, models: ['hang', 'hang'], signal: controller.signal });
    assert.equal(r.code, 2);
    for (const x of r.results) {
      assert.match(x.error, /cancelled/);
      assert.throws(() => process.kill(+readFileSync(x.report + '.pid'), 0));
    }
  } finally { clearTimeout(timer); }
}));

test('invalid inputs fail before launch', () => withFixture(async (opt, dir) => {
  for (const timeout of [0, -1, NaN, Infinity]) await assert.rejects(runReviews({ ...opt, timeout }));
  await assert.rejects(runReviews({ ...opt, models: [] }));
  await assert.rejects(runReviews({ ...opt, persona: '../other' }));
  await assert.rejects(runReviews({ ...opt, failOn: 'nit' }));
  const mission = path.join(dir, 'mission.json');
  writeFileSync(mission, 'null');
  await assert.rejects(runReviews({ ...opt, mission }));
}));
