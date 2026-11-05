#!/usr/bin/env node
// Parallel wrapper for goldfish-check.mjs. No plugin changes.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(os.tmpdir(), 'goldfish');
export const DEFAULT_MODELS = [
  'github-copilot/claude-opus-5.5',
  'github-copilot/claude-opus-5.5',
  'github-copilot/gpt-6.1-sol',
];
const HELP = `Usage: node goldfish-multi.mjs <target> [options]
  --mission <file>       Mission definition or checkpoint
  --model <provider/id>  Repeat for each lens; replaces the three defaults
  --persona <name>      Default: design_critic
  --fail-on blocker|major  Default: blocker
  --timeout <seconds>   Per-lens deadline; default: 600
  --out-dir <folder>    Parent for a unique run folder; default: ${DEFAULT_OUT_DIR.replace(/\\/g, '/')}
All lenses run in parallel, including after another lens fails.
Exit 0: all pass. Exit 1: findings. Exit 2: any run error or cancellation.
Reports retain duplicate findings and lens names. Counts are not unique errors.
The wrapper does not change how mission-mode handles passed check output.`;

async function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('error', resolve);
      killer.on('close', resolve);
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
  }
}

export async function runReviews({ target, mission, models = DEFAULT_MODELS,
  persona = 'design_critic', failOn = 'blocker', timeout = 600,
  outDir = DEFAULT_OUT_DIR, checker = path.join(HERE, 'goldfish-check.mjs'),
  signal, progress = text => console.error(text) }) {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400) throw new Error('timeout must be in (0, 86400]');
  if (!['blocker', 'major'].includes(failOn)) throw new Error('fail-on must be blocker or major');
  if (!models.length || models.length > 8 || models.some(m => !m || m.startsWith('-'))) throw new Error('use 1 to 8 model IDs');
  if (!/^[\w-]+$/.test(persona)) throw new Error('invalid persona name');
  target = path.resolve(target);
  if (!existsSync(target) || !existsSync(checker)) throw new Error('target or checker not found');
  if (mission) {
    mission = path.resolve(mission);
    const parsed = JSON.parse(readFileSync(mission, 'utf8'));
    const m = parsed?.mission ?? parsed;
    if (!m?.goal || !Array.isArray(m.acceptance)) throw new Error('mission needs goal and acceptance');
  }
  mkdirSync(outDir, { recursive: true });
  const dir = mkdtempSync(path.join(path.resolve(outDir), 'multi-'));
  const started = Date.now();
  progress(`START ${models.length} lenses; reports: ${dir}`);
  let finished = 0;
  const results = await Promise.all(models.map((model, i) => new Promise(resolve => {
    const name = `lens-${i + 1}`;
    const report = path.join(dir, `${name}.md`);
    const logPath = path.join(dir, `${name}.log`);
    const log = createWriteStream(logPath);
    const began = Date.now();
    const args = [checker, target, '--model', model, '--persona', persona,
      '--fail-on', failOn, '--timeout', String(timeout + 10), '--out', report];
    if (mission) args.push('--mission', mission);
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let error = '', done = false;
    let stopping;
    const stop = reason => {
      error ||= reason;
      stopping ??= stopTree(child);
    };
    log.on('error', e => stop(`log error: ${e.message}`));
    child.stdout.on('data', data => log.write(data));
    child.stderr.on('data', data => log.write(data));
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop(`timeout after ${timeout}s`), timeout * 1000);
    child.on('error', e => { error ||= `launch failed: ${e.message}`; });
    child.on('close', async (code, childSignal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      await stopping;
      await new Promise(r => log.end(r));
      let counts = null;
      try {
        if (error) throw new Error(error);
        if (code !== 0 && code !== 1) throw new Error(`checker exit ${code}; signal ${childSignal}`);
        const text = readFileSync(report, 'utf8');
        const match = text.match(/COUNTS:\s*blocker=(\d+)\s+major=(\d+)\s+nit=(\d+)\s*$/i);
        if (!match) throw new Error('missing final COUNTS line');
        const values = match.slice(1).map(Number);
        if (values.some(n => !Number.isSafeInteger(n))) throw new Error('invalid counts');
        const [blocker, major, nit] = values;
        counts = { blocker, major, nit };
        const expected = blocker > 0 || (failOn === 'major' && major > 0) ? 1 : 0;
        if (code !== expected) throw new Error('exit code disagrees with report counts');
      } catch (e) { error = e.message; }
      const result = { name, model, code: error ? 2 : code, counts, error: error || null,
        seconds: (Date.now() - began) / 1000, report, log: logPath };
      writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(result, null, 2));
      progress(`DONE ${++finished}/${models.length} ${name} exit=${result.code}`);
      resolve(result);
    });
  })));
  const code = results.some(r => r.code === 2) ? 2 : results.some(r => r.code === 1) ? 1 : 0;
  const summary = { target, mission, persona, failOn, code, seconds: (Date.now() - started) / 1000, results };
  const report = path.join(dir, 'combined.md');
  const sections = results.map(r => `## ${r.name}: ${r.model}\n\nExit: ${r.code}. Time: ${r.seconds.toFixed(1)} s.\n\n` +
    (existsSync(r.report) ? readFileSync(r.report, 'utf8') : '') +
    (r.error ? `\nRun error: ${r.error}\nLog: ${r.log}\n` : ''));
  writeFileSync(report, `# Goldfish parallel review\n\nTarget: ${target}\n\nFindings can overlap. No automatic vote or deduplication.\n\n${sections.join('\n\n')}\n`);
  writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { ...summary, report };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { console.log(HELP); return; }
  const opt = {};
  const keys = { '--mission': 'mission', '--persona': 'persona', '--fail-on': 'failOn', '--timeout': 'timeout', '--out-dir': 'outDir' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model' || keys[arg]) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      if (arg === '--model') (opt.models ??= []).push(value);
      else opt[keys[arg]] = arg === '--timeout' ? Number(value) : value;
    } else if (!arg.startsWith('-') && !opt.target) opt.target = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (!opt.target) throw new Error(HELP);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try {
    const result = await runReviews({ ...opt, signal: controller.signal });
    // Keep this summary short: mission-mode retains only a bounded output tail.
    for (const r of result.results) console.log(`${r.name} ${r.model}: exit=${r.code} counts=${JSON.stringify(r.counts)}${r.error ? ` error=${r.error}` : ''}`);
    console.log(`Full findings: ${result.report}`);
    console.log('Read the combined report. Major findings can exist even when this check passes.');
    console.log(`RESULT: ${['PASS', 'FAIL', 'ERROR'][result.code]}`);
    process.exitCode = result.code;
  } finally {
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`goldfish-multi: ${e.message}`); process.exitCode = 2; });
}
