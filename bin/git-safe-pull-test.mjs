// Local-only integration tests for git-safe-pull.sh. See specs/git-safe-pull.md.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const BASH = process.env.SAFE_PULL_TEST_BASH || "bash";
const GIT = process.env.SAFE_PULL_TEST_GIT || "git";
const SCRIPT = fileURLToPath(new URL('./git-safe-pull.sh', import.meta.url)).replace(/\\/g, "/");
const MODULE = fileURLToPath(new URL('./git-safe-pull-discovery.mjs', import.meta.url));
const BASE = process.env.SAFE_PULL_TEST_TMPDIR || tmpdir();
const discoveryOnly = process.argv.includes('--discovery-only');
const smokeOnly = process.argv.includes('--smoke-only');
mkdirSync(BASE, { recursive: true });
const root = mkdtempSync(join(BASE, "safe-pull-fixture-"));
const evidenceBase = process.env.SAFE_PULL_TEST_EVIDENCE || tmpdir();
mkdirSync(evidenceBase, { recursive: true });
const evidence = mkdtempSync(join(evidenceBase, "safe-pull-evidence-"));
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(GIT_|MSYS)/i.test(k)) delete env[k];
Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid", TMPDIR: root.replace(/\\/g, "/") });
const commands = [], assertions = [], generatedShims = [], skips = [], repositories = new Set();
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
let fails = 0, runtimeError = null;
const ok = (c, n, x = "") => {
  assertions.push({ pass: !!c, name: n, detail: x });
  console.log(`${c ? "PASS" : "FAIL"} ${n}${x ? "  " + x : ""}`); if (!c) fails++;
};
const exec = (command, args, cwd = root, extra = {}) => {
  if (isAbsolute(relative(root, cwd)) || relative(root, cwd).split(/[\\/]/)[0] === "..") throw new Error(`Unsafe cwd: ${cwd}`);
  if (command === BASH && extra.FIXTURE_BIN) {
    const preflight = 'fixture_bin="$FIXTURE_BIN"; if command -v cygpath >/dev/null; then fixture_bin=$(cygpath -u "$fixture_bin") || exit 98; fi; export PATH="$fixture_bin:$PATH"; ' +
      '[ "$(command -v "$FIXTURE_TOOL")" = "$fixture_bin/$FIXTURE_TOOL" ] || exit 98; ' +
      '[ "$("$FIXTURE_TOOL" --fixture-probe)" = "fixture-$FIXTURE_TOOL" ] || exit 98; ';
    args = ["-c", preflight + `exec bash ${args.map(quote).join(" ")}`];
  }
  const started = Date.now();
  const r = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  commands.push({ command, args, cwd, elapsedMs: Date.now() - started, exit: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message });
  if (r.error || r.signal) throw r.error || new Error(`Process stopped: ${r.signal}`);
  if (r.status === 98) throw new Error(`Fixture preflight failed: ${r.stdout}${r.stderr}`);
  return r;
};
const git = (cwd, ...a) => {
  const r = exec(GIT, ["-c", "core.autocrlf=false", ...a], cwd);
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  if (existsSync(join(cwd, ".git"))) repositories.add(cwd);
  return r.stdout;
};
const pullWith = (cwd, args, extra = {}, script = SCRIPT) => exec(BASH, ["-c", `exec bash ${[script, "-C", cwd.replace(/\\/g, "/"), ...args].map(quote).join(" ")}`], cwd, extra);
const pull = (cwd, ...a) => pullWith(cwd, a);
const opt = (cwd, ...a) => pull(cwd, "--stash-local", "--ff-only", ...a);
const put = (cwd, path, text) => { mkdirSync(join(cwd, path, ".."), { recursive: true }); writeFileSync(join(cwd, path), text); };
const text = (cwd, path) => readFileSync(join(cwd, path), "utf8");
const head = (cwd) => git(cwd, "rev-parse", "HEAD").trim();
const stashes = (cwd) => git(cwd, "stash", "list", "--format=%H").trim().split("\n").filter(Boolean);
const snapshot = (cwd) => JSON.stringify({ head: head(cwd), status: git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"),
  index: git(cwd, "ls-files", "--stage", "-z"), diff: git(cwd, "diff", "--binary"), cached: git(cwd, "diff", "--cached", "--binary"), stashes: stashes(cwd) });
const fixture = (name) => {
  const dir = join(root, name); mkdirSync(dir);
  const up = join(dir, "up"), w = join(dir, "writer"), a = join(dir, "main");
  git(dir, "init", "-q", "--bare", "-b", "main", up); git(dir, "clone", "-q", up, w);
  put(w, "README.md", "base\n"); put(w, "local [edit].txt", Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join(""));
  put(w, "keep.md", "keep\n"); put(w, ".gitignore", "ignored.txt\nignored-dir/\n");
  git(w, "add", "."); git(w, "commit", "-qm", "base"); git(w, "push", "-q", "origin", "main"); git(dir, "clone", "-q", up, a);
  return { dir, up, w, a };
};
const advance = (f, edits = { "README.md": "upstream\n" }) => {
  for (const [path, content] of Object.entries(edits)) put(f.w, path, content);
  git(f.w, "add", "-A"); git(f.w, "commit", "-qm", "advance"); git(f.w, "push", "-q", "origin", "main"); return head(f.w);
};
const backup = (cwd, r, name) => {
  const ids = stashes(cwd), output = r.stdout + r.stderr;
  const match = output.match(/git stash apply --index ([0-9a-f]{40,64})/);
  ok(!!match && ids.includes(match[1]), `${name}: exact retained ID and recovery command`, output);
  if (match) ok(git(cwd, "log", "-1", "--format=%s", match[1]).includes("git-safe-pull"), `${name}: named backup`);
  return match?.[1];
};
const noSuccess = (r, name) => ok(r.status !== 0 && !/git-safe-pull: OK/.test(r.stdout + r.stderr), `${name}: failure has no success message`, r.stdout + r.stderr);
const shim = (name, body) => {
  const dir = join(root, `shim-${name}`); mkdirSync(dir);
  const path = join(dir, "git"), log = join(dir, "calls.log").replace(/\\/g, "/");
  const content = `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$*" = --fixture-probe ]; then echo fixture-git; exit 0; fi\n${body}\nexec '${realGit}' "$@"\n`;
  writeFileSync(path, content, { mode: 0o755 }); generatedShims.push({ path, content });
  return { FIXTURE_BIN: dir.replace(/\\/g, "/"), FIXTURE_TOOL: "git" };
};
// Discovery faults stay in fixture PATH shims; never change real permissions.
const discoveryShim = (name, tool, body) => {
  const dir = join(root, `shim-discovery-${name}`); mkdirSync(dir);
  const path = join(dir, tool), log = join(dir, "calls.log").replace(/\\/g, "/");
  const content = `#!/usr/bin/env bash\nif [ "$*" = --fixture-probe ]; then echo fixture-${tool}; exit 0; fi\nprintf '%s\\n' "$*" >> '${log}'\n${body}\n`;
  writeFileSync(path, content, { mode: 0o755 }); generatedShims.push({ path, content });
  return { FIXTURE_BIN: dir.replace(/\\/g, "/"), FIXTURE_TOOL: tool };
};
// Save evidence before worktree inspection and cleanup.
const finalizeRun = (record, path, collect, cleanup) => {
  const save = () => writeFileSync(path, JSON.stringify(record, null, 2));
  const failed = (error) => {
    const detail = error.stack || String(error);
    record.finalizationError = [record.finalizationError, detail].filter(Boolean).join("\n");
    record.runtimeError ||= detail;
  };
  record.cleaned = false;
  try {
    save(); // Save all test results before a worktree command or cleanup can fail.
    if (!record.runtimeError && !record.failures) {
      collect();
      save(); // Keep the worktree lists even if cleanup fails.
      cleanup();
    }
  } catch (error) { failed(error); }
  record.cleaned = !existsSync(record.root);
  try { save(); } catch (error) {
    failed(error);
    console.error("Cannot save final evidence:", JSON.stringify(record));
  }
};
const exitCode = (error, count) => error ? 2 : count ? 1 : 0;
let realGit;
try {
  const resolution = exec(BASH, ['-c', 'command -v git'], root);
  if (resolution.status !== 0) throw new Error('Cannot resolve Git in Bash');
  realGit = resolution.stdout.replace(/\r?\n$/, '');
  if (!discoveryOnly) {
  const up = join(root, "up"), a = join(root, "a"), w = join(root, "w");
  git(root, "init", "-q", "--bare", "-b", "main", up);
  git(root, "clone", "-q", up, w);
  writeFileSync(join(w, "README.md"), "v1\n"); writeFileSync(join(w, "keep.md"), "k1\n");
  git(w, "add", "."); git(w, "commit", "-qm", "c1"); git(w, "push", "-q", "origin", "main");
  git(root, "clone", "-q", up, a);
  // Upstream: changes README, adds journal.md, changes conflict.md (new).
  writeFileSync(join(w, "README.md"), "v2\n"); writeFileSync(join(w, "journal.md"), "j\n"); writeFileSync(join(w, "conflict.md"), "up\n");
  git(w, "add", "."); git(w, "commit", "-qm", "c2"); git(w, "push", "-q", "origin", "main");

  // default duplicate + default preserve: local copies equal to upstream, plus a local change that upstream did not touch.
  writeFileSync(join(a, "README.md"), "v2\n");      // modified, equal to upstream
  writeFileSync(join(a, "journal.md"), "j\n");      // untracked, equal to upstream
  writeFileSync(join(a, "keep.md"), "k-local\n");   // local change, upstream did not touch
  const plain = exec(GIT, ["pull", "-q", "--ff-only"], a);
  ok(plain.status !== 0, "default duplicate before: plain git pull stops", (plain.stderr || "").split("\n")[0]);
  const r1 = pull(a, "-q", "--ff-only");
  ok(r1.status === 0 && /OK \(2 local copies/.test(r1.stdout), "default duplicate: safe pull removes 2 equal copies and pulls", (r1.stdout + r1.stderr).trim().split("\n").pop());
  ok(readFileSync(join(a, "keep.md"), "utf8") === "k-local\n", "default preserve: untouched local change stays");
  ok(git(a, "rev-parse", "HEAD") === git(w, "rev-parse", "HEAD"), "default duplicate: HEAD equals upstream");

  // default refusal: a local file that differs from upstream, and upstream also changed it.
  writeFileSync(join(w, "conflict.md"), "up2\n"); git(w, "commit", "-qam", "c3"); git(w, "push", "-q", "origin", "main");
  writeFileSync(join(a, "conflict.md"), "mine\n");
  const r2 = pull(a, "-q", "--ff-only");
  ok(r2.status === 1 && /M differs conflict\.md/.test(r2.stderr), "default refusal: differing file blocks, exit 1, named", r2.stderr.split("\n").filter((l) => l.includes("conflict")).join(" | "));
  ok(readFileSync(join(a, "conflict.md"), "utf8") === "mine\n", "default refusal: differing file unchanged");

  // Literal paths: a glob-like tracked name, a staged copy, and a run from a subfolder.
  const b = join(root, "b");
  writeFileSync(join(w, "[id].md"), "0\n"); writeFileSync(join(w, "i.md"), "0\n"); git(w, "add", "."); git(w, "commit", "-qm", "c4"); git(w, "push", "-q", "origin", "main");
  git(root, "clone", "-q", up, b);
  writeFileSync(join(w, "[id].md"), "1\n"); writeFileSync(join(w, "keep.md"), "k2\n"); git(w, "commit", "-qam", "c5"); git(w, "push", "-q", "origin", "main");
  writeFileSync(join(b, "[id].md"), "1\n");          // modified, equal to upstream: removed with a literal pathspec
  writeFileSync(join(b, "i.md"), "mine-i\n");         // modified, upstream did not touch: must stay
  writeFileSync(join(b, "keep.md"), "k2\n"); git(b, "add", "keep.md"); // staged copy equal to upstream: must stay
  mkdirSync(join(b, "sub"));
  const r3 = pull(join(b, "sub"), "-q", "--ff-only");
  const out3 = (r3.stdout + r3.stderr).trim().split("\n").join(" | ");
  ok(/removed local copy equal to upstream: \[id\]\.md/.test(r3.stdout), "default literal: run from a subfolder still cleans the root", out3);
  ok(readFileSync(join(b, "i.md"), "utf8") === "mine-i\n", "default literal: i.md kept next to [id].md (literal pathspec)");
  ok(!/equal to upstream: keep\.md/.test(r3.stdout), "default literal: staged copy not touched");

  }
  if (!discoveryOnly && !smokeOnly) {
  // restore: preserve the index and worktree separately. Keep every older stash.
  const f7 = fixture("ac7");
  put(f7.a, "keep.md", "older stash\n"); git(f7.a, "stash", "push", "-qm", "older"); const older = stashes(f7.a);
  const original = text(f7.a, "local [edit].txt");
  const pinned7 = advance(f7, { "README.md": "upstream\n", "copy [new].txt": "copy\n", "local [edit].txt": original.replace("line 14\n", "upstream 14\n") });
  const staged = original.replace("line 2\n", "staged 2\n"), unstaged = staged.replace("line 25\n", "unstaged 25\n");
  for (const [key, value] of [["merge.autoStash", "true"], ["submodule.recurse", "true"], ["fetch.recurseSubmodules", "true"], ["status.showUntrackedFiles", "no"], ["diff.ignoreSubmodules", "all"]]) git(f7.a, "config", key, value);
  const config7 = text(f7.a, ".git/config");
  put(f7.a, "local [edit].txt", staged); git(f7.a, "add", "--", "local [edit].txt"); put(f7.a, "local [edit].txt", unstaged);
  put(f7.a, "note [new].txt", "untracked\n"); put(f7.a, "README.md", "upstream\n"); put(f7.a, "copy [new].txt", "copy\n");
  put(f7.a, "ignored.txt", "ignored bytes\n");
  const r7 = opt(f7.a, "-q", "origin", "main");
  ok(r7.status === 0 && head(f7.a) === pinned7, "restore: pinned fast-forward", r7.stdout + r7.stderr);
  ok(text(f7.a, "local [edit].txt") === unstaged.replace("line 14\n", "upstream 14\n") && git(f7.a, "show", ":local [edit].txt") === staged.replace("line 14\n", "upstream 14\n"), "restore: staged and unstaged bytes stay separate with disjoint upstream change");
  ok(text(f7.a, ".git/config") === config7, "restore: hostile persistent settings stay unchanged");
  ok(text(f7.a, "note [new].txt") === "untracked\n" && text(f7.a, "ignored.txt") === "ignored bytes\n", "restore: untracked and ignored bytes stay");
  ok(/OK \(2 local copies/.test(r7.stdout), "restore: literal duplicate cleanup");
  const id7 = backup(f7.a, r7, "restore"); ok(stashes(f7.a).length === older.length + 1 && older.every((id) => stashes(f7.a).includes(id)), "restore: older stash entries stay");
  if (id7) ok(!git(f7.a, "ls-tree", "-r", "--name-only", `${id7}^3`).includes("ignored.txt"), "restore: ignored file not stashed");

  const rename = fixture("ac7-rename"); advance(rename); git(rename.a, "mv", "keep.md", "renamed [keep].md"); put(rename.a, "new [note].md", "new note\n");
  const renameResult = opt(rename.a); backup(rename.a, renameResult, "restore rename");
  ok(renameResult.status === 0 && git(rename.a, "status", "--porcelain=v1").includes('R  keep.md -> "renamed [keep].md"') && text(rename.a, "new [note].md") === "new note\n", "restore: staged rename and literal untracked name restored", renameResult.stdout + renameResult.stderr);
  const equalStage = fixture("ac7-staged-equal"); advance(equalStage); put(equalStage.a, "README.md", "upstream\n"); git(equalStage.a, "add", "README.md");
  const equalResult = opt(equalStage.a); const equalID = backup(equalStage.a, equalResult, "restore staged equal");
  ok(!equalResult.stdout.includes("removed local copy"), "restore: staged equal copy is not duplicate cleanup");
  if (equalID) ok(git(equalStage.a, "show", `${equalID}^2:README.md`) === "upstream\n", "restore: staged equal copy is in backup index");

  // preflight: supported argument forms and fail-closed prerequisites.
  for (const [name, args] of [["upstream", ["--ff-only"]], ["quiet", ["--ff-only", "--quiet", "origin", "main"]], ["full-ref", ["--ff-only", "-q", "origin", "refs/heads/main"]]]) {
    const f = fixture(`ac8-${name}`), target = advance(f); const r = pull(f.a, "--stash-local", ...args);
    ok(r.status === 0 && head(f.a) === target && stashes(f.a).length === 0, `preflight: clean ${name}, no stash`, r.stdout + r.stderr);
  }
  for (const [i, args] of [["missing-ff", []], ["quiet-first", ["-q", "--ff-only"]], ["repeat-ff", ["--ff-only", "--ff-only"]], ["late-quiet", ["--ff-only", "origin", "main", "-q"]], ["rebase", ["--ff-only", "--rebase"]], ["autostash", ["--ff-only", "--autostash"]],
    ["one-operand", ["--ff-only", "origin"]], ["refspec", ["--ff-only", "origin", "main:other"]], ["wildcard", ["--ff-only", "origin", "*"]],
    ["extra", ["--ff-only", "origin", "main", "other"]], ["missing-fetch", ["--ff-only", "missing-remote", "main"]]]) {
    const f = fixture(`ac8-${i}`); advance(f); put(f.a, "keep.md", "mine\n"); put(f.a, "new.txt", "new bytes\n");
    const before = snapshot(f.a), r = pull(f.a, "--stash-local", ...args); noSuccess(r, `preflight ${i}`);
    ok(snapshot(f.a) === before && text(f.a, "new.txt") === "new bytes\n", `preflight ${i}: local state unchanged`);
  }
  const modeOrder = fixture('mode-order'); advance(modeOrder); put(modeOrder.a, 'README.md', 'upstream\n');
  const modeBefore = snapshot(modeOrder.a), modeResult = pull(modeOrder.a, '-q', '--stash-local', '--ff-only');
  noSuccess(modeResult, 'misplaced mode option');
  ok(snapshot(modeOrder.a) === modeBefore && text(modeOrder.a, 'README.md') === 'upstream\n', 'misplaced mode option: no duplicate cleanup');
  const diverged = fixture("ac8-diverged"); advance(diverged); put(diverged.a, "own.txt", "own\n"); git(diverged.a, "add", "."); git(diverged.a, "commit", "-qm", "own");
  put(diverged.a, "README.md", "upstream\n"); const bd = snapshot(diverged.a), rd = opt(diverged.a); noSuccess(rd, "preflight divergence");
  ok(snapshot(diverged.a) === bd, "preflight divergence: no equal-copy cleanup before refusal");
  for (const state of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const f = fixture(`ac8-${state}`); advance(f); put(f.a, "README.md", "upstream\n");
    const statePath = git(f.a, "rev-parse", "--git-path", state).trim();
    if (state.includes("HEAD")) put(f.a, statePath, head(f.a) + "\n"); else mkdirSync(join(f.a, statePath));
    const before = snapshot(f.a), r = opt(f.a); noSuccess(r, `preflight ${state}`); ok(snapshot(f.a) === before, `preflight ${state}: unchanged`);
  }
  const linked = fixture("ac8-linked"), linkedPath = join(linked.dir, "linked");
  git(linked.a, "worktree", "add", "-q", "-b", "linked", linkedPath); advance(linked); put(linkedPath, "README.md", "upstream\n");
  writeFileSync(git(linkedPath, "rev-parse", "--git-path", "MERGE_HEAD").trim(), head(linkedPath) + "\n");
  const bl = snapshot(linkedPath), rl = opt(linkedPath, "origin", "main"); noSuccess(rl, "preflight linked state"); ok(snapshot(linkedPath) === bl, "preflight linked state: unchanged");

  const unresolved = fixture("ac8-unresolved"); advance(unresolved); put(unresolved.a, "README.md", "local unresolved\n");
  const blob = git(unresolved.a, "rev-parse", "HEAD:README.md").trim();
  const indexInput = `0 ${"0".repeat(40)}\tREADME.md\n100644 ${blob} 1\tREADME.md\n100644 ${blob} 2\tREADME.md\n100644 ${blob} 3\tREADME.md\n`;
  put(unresolved.dir, "index-input", indexInput);
  const ui = exec(BASH, ["-c", `"${realGit}" update-index --index-info < '${join(unresolved.dir, "index-input").replace(/\\/g, "/")}'`], unresolved.a);
  if (ui.status !== 0) throw new Error(ui.stderr);
  const bu = snapshot(unresolved.a), ru = opt(unresolved.a); noSuccess(ru, "preflight unresolved"); ok(snapshot(unresolved.a) === bu && text(unresolved.a, "README.md") === "local unresolved\n", "preflight: unresolved index unchanged");
  for (const [name, match] of [["ancestry", '[[ " $* " == *" merge-base "* ]]'], ["status", '[[ " $* " == *" status "* ]]'],
    ["cleanup", '[[ " $* " == *" checkout "* ]]'], ["stash", '[[ " $* " == *" stash push "* ]]']]) {
    const f = fixture(`ac8-command-${name}`); advance(f); put(f.a, name === "cleanup" ? "README.md" : "keep.md", name === "cleanup" ? "upstream\n" : "mine\n");
    const before = snapshot(f.a), injected = shim(`fail-${name}`, `if ${match}; then echo 'fixture ${name} failure' >&2; exit 74; fi`);
    const r = pullWith(f.a, ["--stash-local", "--ff-only"], injected); noSuccess(r, `preflight ${name} failure`);
    ok((r.stdout + r.stderr).includes(`fixture ${name} failure`) && snapshot(f.a) === before, `preflight ${name}: injected command failed, local state unchanged`);
  }

  // recovery: real apply conflict, returned update failure, and exact-ID recovery.
  const conflict = fixture("ac9-conflict"), target9 = advance(conflict); put(conflict.a, "README.md", "local conflict\n");
  const r9 = opt(conflict.a); noSuccess(r9, "recovery restore conflict"); const id9 = backup(conflict.a, r9, "recovery conflict");
  ok(head(conflict.a) === target9 && git(conflict.a, "ls-files", "-u").includes("README.md"), "recovery: conflict entries stay");
  if (id9) ok(git(conflict.a, "show", `${id9}:README.md`) === "local conflict\n", "recovery: backup has exact local bytes");
  const failed = fixture("ac9-update-failure"); advance(failed); put(failed.a, "keep.md", "stage\n"); git(failed.a, "add", "keep.md"); put(failed.a, "keep.md", "work\n"); put(failed.a, "new.txt", "new\n");
  const bf = head(failed.a), failureEnv = shim("update", 'for arg in "$@"; do if [ "$arg" = merge ]; then echo "fixture update failure" >&2; exit 73; fi; done');
  const rf = pullWith(failed.a, ["--stash-local", "--ff-only"], failureEnv); noSuccess(rf, "recovery update failure"); backup(failed.a, rf, "recovery update failure");
  ok(rf.stderr.includes("fixture update failure") && rf.stderr.includes("fast-forward failed (exit 73)") && rf.stdout.includes("restore succeeded"), "recovery: update and restore outcomes are separate");
  ok(head(failed.a) === bf && text(failed.a, "keep.md") === "work\n" && git(failed.a, "show", ":keep.md") === "stage\n" && text(failed.a, "new.txt") === "new\n", "recovery: update failure restores index and worktree");
  const exact = fixture("ac9-exact-id"); advance(exact); put(exact.a, "keep.md", "exact bytes\n");
  const exactEnv = shim("exact", `for arg in "$@"; do if [ "$arg" = merge ]; then\n  '${realGit}' "$@" || exit $?\n  printf 'other stash\\n' > other-stash.txt\n  '${realGit}' stash push -u -qm fixture-other || exit $?\n  exit 0\nfi; done`);
  const re = pullWith(exact.a, ["--stash-local", "--ff-only"], exactEnv); const ide = backup(exact.a, re, "recovery exact ID");
  ok(re.status === 0 && text(exact.a, "keep.md") === "exact bytes\n" && !existsSync(join(exact.a, "other-stash.txt")) && stashes(exact.a).length === 2 && stashes(exact.a)[0] !== ide, "recovery: restore uses ID, not stash position", re.stdout + re.stderr);
  const exactCalls = text(exactEnv.FIXTURE_BIN, "calls.log").split("\n"), fetchCalls = exactCalls.filter((s) => /(?:^| )fetch /.test(s)), mergeCalls = exactCalls.filter((s) => /(?:^| )merge /.test(s));
  ok(fetchCalls.length === 1 && mergeCalls.length === 1 && mergeCalls[0].endsWith(`--ff-only --no-squash --no-autostash --no-overwrite-ignore ${head(exact.w)}`), "recovery: one fetch and one pinned fast-forward");

  // protected paths: ignored collision and remaining status under hostile local settings.
  const ignored = fixture("ac10-ignored"); put(ignored.w, "ignored.txt", "upstream ignored collision\n"); git(ignored.w, "add", "-f", "ignored.txt"); git(ignored.w, "commit", "-qm", "collision"); git(ignored.w, "push", "-q", "origin", "main");
  put(ignored.a, "ignored.txt", "ignored local\n"); put(ignored.a, "keep.md", "keep local\n");
  git(ignored.a, "config", "merge.autoStash", "true"); git(ignored.a, "config", "submodule.recurse", "true"); git(ignored.a, "config", "fetch.recurseSubmodules", "true");
  const bi = head(ignored.a), ri = opt(ignored.a); noSuccess(ri, "protected paths ignored collision"); backup(ignored.a, ri, "protected paths ignored collision");
  ok(head(ignored.a) === bi && text(ignored.a, "ignored.txt") === "ignored local\n" && text(ignored.a, "keep.md") === "keep local\n", "protected paths: ignored file not overwritten, local state restored");
  const remaining = fixture("ac10-remaining"); advance(remaining); put(remaining.a, "keep.md", "retained\n");
  git(remaining.a, "config", "status.showUntrackedFiles", "no"); git(remaining.a, "config", "diff.ignoreSubmodules", "all");
  const remainingEnv = shim("remaining", `if [[ " $* " == *" stash push "* ]]; then\n  '${realGit}' "$@" || exit $?\n  printf 'unstashable fixture content\\n' > remaining.txt\n  exit 0\nfi`);
  const br = head(remaining.a), rr = pullWith(remaining.a, ["--stash-local", "--ff-only"], remainingEnv); noSuccess(rr, "protected paths remaining status"); backup(remaining.a, rr, "protected paths remaining status");
  ok(head(remaining.a) === br && text(remaining.a, "keep.md") === "retained\n" && existsSync(join(remaining.a, "remaining.txt")) && text(remaining.a, "remaining.txt") === "unstashable fixture content\n", "protected paths: remaining status stops update and restores backup");
  for (const kind of ["directory", "gitfile", "ignored"]) {
    const f = fixture(`ac10-nested-${kind}`), nested = kind === "ignored" ? "ignored-dir/nested" : "nested";
    mkdirSync(join(f.a, nested), { recursive: true });
    if (kind === "gitfile") git(f.a, "init", "-q", "--separate-git-dir", join(f.dir, "nested-git"), join(f.a, nested)); else git(f.a, "init", "-q", join(f.a, nested));
    put(f.a, `${nested}/bytes.txt`, "nested bytes\n"); git(join(f.a, nested), "add", "."); git(join(f.a, nested), "commit", "-qm", "nested");
    if (kind === "ignored") { put(f.w, `${nested}/bytes.txt`, "target bytes\n"); git(f.w, "add", "-f", `${nested}/bytes.txt`); git(f.w, "commit", "-qm", "target"); git(f.w, "push", "-q", "origin", "main"); }
    else advance(f, { [`${nested}/bytes.txt`]: "target bytes\n" });
    put(f.a, "keep.md", "local\n"); const before = snapshot(f.a), bn = snapshot(join(f.a, nested)), r = opt(f.a);
    noSuccess(r, `protected paths nested ${kind}`); ok(snapshot(f.a) === before && snapshot(join(f.a, nested)) === bn && text(f.a, `${nested}/bytes.txt`) === "nested bytes\n", `protected paths nested ${kind}: no mutation`);
  }
  const sub = fixture("ac10-submodule"), child = fixture("ac10-child");
  git(sub.w, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child.up, "module"); git(sub.w, "commit", "-qam", "submodule"); git(sub.w, "push", "-q", "origin", "main");
  git(sub.a, "fetch", "-q"); git(sub.a, "merge", "-q", "--ff-only", "origin/main"); git(sub.a, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "-q");
  const module = join(sub.a, "module"); repositories.add(module);
  git(sub.a, "config", "submodule.recurse", "true"); git(sub.a, "config", "submodule.module.ignore", "all"); git(sub.a, "config", "diff.ignoreSubmodules", "all"); git(sub.a, "config", "status.showUntrackedFiles", "no");
  advance(sub); const cleanModule = snapshot(module), cleanSubResult = opt(sub.a);
  ok(cleanSubResult.status === 0 && snapshot(module) === cleanModule, "protected paths: unrelated update leaves clean submodule unchanged", cleanSubResult.stdout + cleanSubResult.stderr);
  advance(sub, { "README.md": "next upstream\n" }); put(module, "keep.md", "dirty child\n");
  const dirtyParent = snapshot(sub.a), dirtyModule = snapshot(module), dirtyResult = opt(sub.a); noSuccess(dirtyResult, "protected paths hidden dirty submodule");
  ok(snapshot(sub.a) === dirtyParent && snapshot(module) === dirtyModule, "protected paths: hostile ignore settings cannot hide dirty submodule");
  const childTarget = advance(child); git(join(sub.w, "module"), "fetch", "-q"); git(join(sub.w, "module"), "checkout", "-q", childTarget); git(sub.w, "add", "module"); git(sub.w, "commit", "-qm", "move module"); git(sub.w, "push", "-q", "origin", "main");
  const bs = snapshot(sub.a), bm = snapshot(module), rs = opt(sub.a); noSuccess(rs, "protected paths submodule target"); ok(snapshot(sub.a) === bs && snapshot(module) === bm, "protected paths: no recursive submodule update");

  // Merge postcondition: override inherited squash and verify the actual update result.
  const squash = fixture("merge-squash"), squashTarget = advance(squash); git(squash.a, "config", "branch.main.mergeOptions", "--squash");
  const squashConfig = text(squash.a, ".git/config"), squashResult = opt(squash.a);
  ok(squashResult.status === 0 && head(squash.a) === squashTarget && git(squash.a, "status", "--porcelain=v1") === "" && stashes(squash.a).length === 0, "merge postcondition: inherited squash cannot prevent HEAD update", squashResult.stdout + squashResult.stderr);
  ok(text(squash.a, ".git/config") === squashConfig, "merge postcondition: persistent squash setting unchanged");
  const noAdvance = fixture("merge-no-advance"); advance(noAdvance); put(noAdvance.a, "keep.md", "staged\n"); git(noAdvance.a, "add", "keep.md"); put(noAdvance.a, "keep.md", "unstaged\n"); put(noAdvance.a, "note.txt", "untracked\n");
  const noAdvanceHead = head(noAdvance.a), noAdvanceEnv = shim("no-advance", 'for arg in "$@"; do if [ "$arg" = merge ]; then echo "fixture zero-exit merge"; exit 0; fi; done');
  const noAdvanceResult = pullWith(noAdvance.a, ["--stash-local", "--ff-only"], noAdvanceEnv);
  noSuccess(noAdvanceResult, "merge postcondition zero-exit non-advancing merge"); backup(noAdvance.a, noAdvanceResult, "merge postcondition postcondition");
  ok(head(noAdvance.a) === noAdvanceHead && text(noAdvance.a, "keep.md") === "unstaged\n" && git(noAdvance.a, "show", ":keep.md") === "staged\n" && text(noAdvance.a, "note.txt") === "untracked\n", "merge postcondition: postcondition failure restores exact local state");
  ok(/HEAD.*target/.test(noAdvanceResult.stderr) && /restore succeeded/.test(noAdvanceResult.stdout) && !/fast-forward succeeded/.test(noAdvanceResult.stdout), "merge postcondition: false update success is not reported");
  }

  if (!smokeOnly) {
    // Each fault must precede duplicate cleanup and stash. Reuse an unchanged fixture.
    const f = fixture('discovery-faults'); advance(f);
    put(f.a, 'keep.md', 'prior stash\n'); git(f.a, 'stash', 'push', '-qm', 'prior');
    put(f.a, 'README.md', 'upstream\n'); put(f.a, 'keep.md', 'staged\n'); git(f.a, 'add', 'keep.md');
    put(f.a, 'keep.md', 'unstaged\n'); put(f.a, 'note [new].txt', 'untracked\0bytes\n');
    const before = snapshot(f.a);
    const prefix = ['git-safe-pull-discovery-v1', 'root', '.'];
    const emit = fields => `printf '%s\\0' ${fields.map(quote).join(' ')};`;
    const valid = [...prefix, 'complete', '1', '0'];
    const faults = [
      ['producer-error', emit(valid) + ' echo "fixture read failure" >&2; exit 74', /discovery failed/],
      ['consumer-error', '/usr/bin/head -c 4194305; exit 75', /discovery failed/, 'head'],
      ['consumer-partial', '/usr/bin/head -c 1', /incomplete.*discovery|discovery failed/, 'head'],
      ['empty', 'exit 0', /incomplete.*discovery/],
      ['partial-field', emit(prefix) + " printf 'protected'", /incomplete.*discovery/],
      ['missing-complete', emit(prefix), /incomplete.*discovery/],
      ['wrong-version', emit(['v0', ...valid.slice(1)]), /malformed.*version/],
      ['wrong-root', emit([prefix[0], 'root', 'other', 'complete', '1', '0']), /malformed.*root/],
      ['unknown-type', emit([...prefix, 'unknown']), /malformed.*type/],
      ['zero-count', emit([...prefix, 'complete', '0', '0']), /malformed.*count/],
      ['large-count', emit([...prefix, 'complete', '10001', '0']), /malformed.*count/],
      ['invalid-count', emit([...prefix, 'complete', '01', '0']), /malformed.*count/],
      ['wrong-protected-count', emit([...prefix, 'complete', '2', '1']), /malformed.*count/],
      ['extra-field', emit([...valid, 'extra']), /extra.*discovery/],
      ['extra-partial', emit(valid) + " printf 'extra'", /extra.*discovery/],
      ['timeout', 'sleep 5', /discovery timed out/],
      ['oversize', '/usr/bin/head -c 4194305 /dev/zero', /output limit/],
      ...['', '/absolute', 'C:/absolute', ...(process.platform === 'win32' ? ['C:relative', 'a\\b'] : []), 'a/../b', './a', 'a//b', 'a/.'].map((path, i) =>
        [`bad-path-${i}`, emit([...prefix, 'protected', path, 'complete', '2', '1']), /malformed.*path/])
    ];
    for (const [name, body, reason, tool = 'node'] of faults) {
      const injected = discoveryShim(name, tool, body);
      if (name === 'timeout') writeFileSync(join(injected.FIXTURE_BIN, 'timeout'), '#!/usr/bin/env bash\nif [ "${1:-}" = --kill-after=2s ] && [ "${2:-}" = 30s ]; then shift 2; exec /usr/bin/timeout --kill-after=1s 1s "$@"; fi\nexec /usr/bin/timeout "$@"\n', { mode: 0o755 });
      const r = pullWith(f.a, ['--stash-local', '--ff-only'], injected);
      noSuccess(r, `discovery ${name}`);
      ok(reason.test(r.stderr), `discovery ${name}: refusal reason`, r.stderr);
      ok(snapshot(f.a) === before && text(f.a, 'README.md') === 'upstream\n' && text(f.a, 'keep.md') === 'unstaged\n' && text(f.a, 'note [new].txt') === 'untracked\0bytes\n', `discovery ${name}: no mutation`);
    }
    const unusual = 'odd : [x]\tline\nbreak';
    const injected = shim('literal-protocol', `if [[ " $* " == *" diff --name-only "* ]]; then ${emit([`${unusual}/incoming`])} exit 0; fi`);
    writeFileSync(join(injected.FIXTURE_BIN, 'node'), '#!/usr/bin/env bash\n' + emit([...prefix, 'protected', unusual, 'complete', '2', '1']), { mode: 0o755 });
    const literal = pullWith(f.a, ['--stash-local', '--ff-only'], injected);
    noSuccess(literal, 'literal protocol');
    ok(literal.stderr.includes(`nested repository or submodule could change: ${unusual}`) && snapshot(f.a) === before, 'literal protocol: spaces, colons, brackets, tab and newline stay intact');

    const copies = join(root, 'runtime files with spaces'); mkdirSync(copies);
    const copiedScript = join(copies, 'git-safe-pull.sh').replace(/\\/g, '/'); copyFileSync(SCRIPT, copiedScript);
    const missingModule = pullWith(f.a, ['--stash-local', '--ff-only'], {}, copiedScript);
    noSuccess(missingModule, 'missing module'); ok(/module is missing/.test(missingModule.stderr) && snapshot(f.a) === before, 'missing module: no mutation');
    writeFileSync(join(copies, 'git-safe-pull-discovery.mjs'), 'throw new Error("fixture module load failure");\n');
    const brokenModule = pullWith(f.a, ['--stash-local', '--ff-only'], {}, copiedScript);
    noSuccess(brokenModule, 'module load error'); ok(/fixture module load failure/.test(brokenModule.stderr) && snapshot(f.a) === before, 'module error: no mutation');
    const noNode = join(root, 'without-node'); mkdirSync(noNode);
    writeFileSync(join(noNode, 'git'), `#!/bin/bash\nexec ${quote(realGit)} "$@"\n`, { mode: 0o755 });
    const missingNode = exec(BASH, ['-c', `without_node=${quote(noNode.replace(/\\/g, '/'))}; if command -v cygpath >/dev/null; then without_node=$(cygpath -u "$without_node") || exit 98; fi; export PATH="$without_node"; exec /bin/bash ${[SCRIPT, '-C', f.a.replace(/\\/g, '/'), '--stash-local', '--ff-only'].map(quote).join(' ')}`], f.a);
    noSuccess(missingNode, 'missing Node'); ok(/Node.js is required/.test(missingNode.stderr) && snapshot(f.a) === before, 'missing Node: no mutation');
    const oldGit = shim('unsupported-git-path', 'if [[ " $* " == *" --path-format=absolute "* ]]; then printf "%s\\n" --path-format=absolute; exit 0; fi');
    const unsupported = pullWith(f.a, ['--stash-local', '--ff-only'], oldGit);
    noSuccess(unsupported, 'unsupported Git path option'); ok(/absolute Git directory/.test(unsupported.stderr) && snapshot(f.a) === before, 'unsupported Git: no mutation');

    copyFileSync(MODULE, join(copies, 'git-safe-pull-discovery.mjs'));
    for (const [name, script] of [['checkout', SCRIPT], ['copied', copiedScript]]) {
      const portable = fixture(`portable-${name}`), target = advance(portable); put(portable.a, 'keep.md', 'local\n');
      const r = exec(BASH, ['-c', `exec bash ${[script, '-C', portable.a.replace(/\\/g, '/'), '--stash-local', '--ff-only'].map(quote).join(' ')}`], root);
      ok(r.status === 0 && head(portable.a) === target && text(portable.a, 'keep.md') === 'local\n', `${name}: run from unrelated directory`, r.stdout + r.stderr);
      advance(portable, { 'README.md': 'next\n' }); mkdirSync(join(portable.a, 'sub'));
      const subfolder = exec(BASH, ['-c', `exec bash ${[script, '--stash-local', '--ff-only'].map(quote).join(' ')}`], join(portable.a, 'sub'));
      ok(subfolder.status === 0 && head(portable.a) === head(portable.w), `${name}: run from repository subfolder`, subfolder.stdout + subfolder.stderr);
    }
    // A Git path can end with LF. Remove only the delimiter that Git adds.
    const pathTransport = fixture('git-path-transport'), transportTarget = advance(pathTransport);
    const transport = shim('git-path-transport', 'case " $* " in *" --path-format=absolute --git-dir "*) printf "C:/fixture-current\\n\\n"; exit 0;; *" --path-format=absolute --git-common-dir "*) printf "C:/fixture-common\\n\\n\\n"; exit 0;; esac');
    writeFileSync(join(transport.FIXTURE_BIN, 'node'), '#!/usr/bin/env bash\n[ "$3" = $\'C:/fixture-current\\n\' ] && [ "$4" = $\'C:/fixture-common\\n\\n\' ] || exit 76\n' + emit(valid), { mode: 0o755 });
    const transportResult = pullWith(pathTransport.a, ['--stash-local', '--ff-only'], transport);
    ok(transportResult.status === 0 && head(pathTransport.a) === transportTarget, 'Git path transport preserves trailing newlines', transportResult.stdout + transportResult.stderr);

    for (const kind of ['current', 'common']) {
      const f = fixture(`relocated-${kind}`); advance(f);
      let checkout = f.a, metadata;
      if (kind === 'current') {
        metadata = join(checkout, 'admin');
        git(checkout, 'init', '-q', '--separate-git-dir', metadata);
      } else {
        checkout = join(f.dir, 'linked'); git(f.a, 'worktree', 'add', '-q', '-b', 'linked', checkout);
        metadata = join(checkout, 'admin'); renameSync(join(f.a, '.git'), metadata);
        put(f.a, '.git', `gitdir: ${metadata.replace(/\\/g, '/')}\n`);
        // Git can make this generated marker hidden on Windows. Recreate it;
        // do not change permissions or open a hidden file with the write flag.
        unlinkSync(join(checkout, '.git'));
        put(checkout, '.git', `gitdir: ${join(metadata, 'worktrees', 'linked').replace(/\\/g, '/')}\n`);
      }
      git(checkout, 'fetch', '-q', 'origin', 'main');
      put(checkout, 'README.md', 'upstream\n'); put(checkout, 'keep.md', 'local\n');
      const before = snapshot(checkout), r = opt(checkout, 'origin', 'main'); noSuccess(r, `relocated ${kind} status`);
      ok(/nested repository.*admin/.test(r.stderr) && snapshot(checkout) === before && text(checkout, 'README.md') === 'upstream\n' && text(checkout, 'keep.md') === 'local\n', `relocated ${kind}: no cleanup or stash of metadata`, r.stdout + r.stderr);
      put(metadata, 'info/exclude', 'admin/\n');
      advance(f, { 'admin/new.txt': 'incoming\n' }); git(checkout, 'fetch', '-q', 'origin', 'main');
      const targetBefore = snapshot(checkout), targetResult = opt(checkout, 'origin', 'main'); noSuccess(targetResult, `relocated ${kind} target`);
      ok(/nested repository.*admin/.test(targetResult.stderr) && snapshot(checkout) === targetBefore && !existsSync(join(metadata, 'new.txt')), `relocated ${kind}: ignored metadata target refused`);
    }

    for (const kind of ['gitfile-inside', 'bare-refs', 'bare-reftable']) {
      const nested = fixture(`metadata-${kind}`), path = 'ignored-dir/nested';
      mkdirSync(join(nested.a, path), { recursive: true });
      if (kind === 'gitfile-inside') {
        put(nested.a, `${path}/.git`, 'gitdir: admin\n'); mkdirSync(join(nested.a, path, 'admin', ...Array(65).fill('d')), { recursive: true });
      } else {
        put(nested.a, `${path}/HEAD`, 'damaged HEAD'); mkdirSync(join(nested.a, path, 'objects'));
        mkdirSync(join(nested.a, path, kind === 'bare-refs' ? 'refs' : 'reftable'));
      }
      advance(nested); const allowed = opt(nested.a);
      ok(allowed.status === 0, `${kind}: metadata is not scanned`, allowed.stdout + allowed.stderr);
      put(nested.w, `${path}/new.txt`, 'incoming\n'); git(nested.w, 'add', '-f', `${path}/new.txt`); git(nested.w, 'commit', '-qm', 'nested target'); git(nested.w, 'push', '-q', 'origin', 'main');
      put(nested.a, 'README.md', 'local\n'); const prior = snapshot(nested.a), refused = opt(nested.a); noSuccess(refused, kind);
      ok(/nested repository/.test(refused.stderr) && snapshot(nested.a) === prior && !existsSync(join(nested.a, path, 'new.txt')), `${kind}: target refused before mutation`);
    }
    if (process.platform === 'win32') {
      const f = fixture('case-variant'), nested = join(f.a, 'ignored-dir/NESTED');
      git(f.a, 'init', '-q', nested); put(nested, 'keep.txt', 'nested\n'); git(nested, 'add', '.'); git(nested, 'commit', '-qm', 'nested');
      put(f.w, 'ignored-dir/nested/new.txt', 'incoming\n'); git(f.w, 'add', '-f', 'ignored-dir/nested/new.txt'); git(f.w, 'commit', '-qm', 'case target'); git(f.w, 'push', '-q', 'origin', 'main');
      put(f.a, 'keep.md', 'local\n'); const parent = snapshot(f.a), child = snapshot(nested), r = opt(f.a); noSuccess(r, 'case-variant new target');
      ok(/nested repository/.test(r.stderr) && snapshot(f.a) === parent && snapshot(nested) === child && !existsSync(join(nested, 'new.txt')), 'case-variant ignored nested path: no mutation');
    } else { skips.push('Windows case-variant target test'); console.log('SKIP Windows case-variant target test'); }
    for (const kind of ['directories', 'depth']) {
      const f = fixture(`limit-${kind}`); advance(f); put(f.a, 'README.md', 'upstream\n'); put(f.a, 'keep.md', 'local\n');
      mkdirSync(join(f.a, 'ignored-dir'));
      if (kind === 'directories') for (let i = 0; i < 10000; i++) mkdirSync(join(f.a, 'ignored-dir', `d${i}`));
      else mkdirSync(join(f.a, 'ignored-dir', ...Array(64).fill('d')), { recursive: true });
      const before = snapshot(f.a), r = opt(f.a); noSuccess(r, `${kind} limit`);
      ok((kind === 'directories' ? /directory limit.*10000/ : /depth limit.*64/).test(r.stderr) && snapshot(f.a) === before, `${kind} limit: no mutation`);
    }
  }
} catch (error) {
  runtimeError = error.stack; console.error(runtimeError);
} finally {
  const worktrees = [], record = { root, commands, assertions, generatedShims, skips, worktrees, runtimeError, failures: fails };
  finalizeRun(record, join(evidence, 'run.json'), () => {
    for (const cwd of repositories) worktrees.push({ cwd, output: git(cwd, 'worktree', 'list', '--porcelain'), staged: git(cwd, 'diff', '--cached', '--name-status') });
  }, () => rmSync(root, { recursive: true, force: true }));
  runtimeError = record.runtimeError;
  if (record.finalizationError) console.error(record.finalizationError);
  console.log(`EVIDENCE ${evidence}`);
}
console.log(runtimeError ? 'UNEXPECTED RUNTIME FAILURE' : fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(exitCode(runtimeError, fails));
