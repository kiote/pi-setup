// Read-only discovery tests. Run: node --test bin/git-safe-pull-discovery-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverRepositories } from './git-safe-pull-discovery.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), 'safe-pull-discovery-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'checkout'), gitDirectory = join(base, 'metadata');
  fs.mkdirSync(root); fs.mkdirSync(gitDirectory);
  return { base, root, gitDirectory, commonDirectory: gitDirectory };
}
function directory(path) { fs.mkdirSync(path, { recursive: true }); }
function file(path, text = '') { directory(join(path, '..')); fs.writeFileSync(path, text); }
function forbidEnumeration(paths) {
  const excluded = paths.map(p => resolve(p));
  return { ...fs, readdirSync(path, ...args) {
    assert.ok(!excluded.includes(resolve(path)), `Must not enumerate ${path}`);
    return fs.readdirSync(path, ...args);
  } };
}

test('nested gitfile protects its root before enumeration of relocated metadata', t => {
  const f = fixture(t), nested = join(f.root, 'nested');
  file(join(nested, '.git'), 'gitdir: admin\n');
  directory(join(nested, 'admin', 'objects'));
  const result = discoverRepositories(f, forbidEnumeration([nested, join(nested, 'admin'), join(nested, 'admin', 'objects')]));
  assert.deepEqual(result, { protectedRoots: ['nested'], directoryCount: 2 });
});

test('relocated current and common metadata are excluded but their parent is not', t => {
  const f = fixture(t);
  f.gitDirectory = join(f.root, 'storage', 'current');
  f.commonDirectory = join(f.root, 'storage', 'common');
  directory(f.gitDirectory); directory(f.commonDirectory);
  file(join(f.root, 'storage', 'nested', '.git'));
  const result = discoverRepositories(f, forbidEnumeration([f.gitDirectory, f.commonDirectory]));
  assert.deepEqual(result.protectedRoots.sort(), ['storage/common', 'storage/current', 'storage/nested']);
});

test('ordinary nested marker and bare refs or reftable layouts are not enumerated', t => {
  const f = fixture(t), paths = [];
  for (const kind of ['worktree', 'refs', 'reftable']) {
    const path = join(f.root, kind); paths.push(path);
    if (kind === 'worktree') directory(join(path, '.git'));
    else { file(join(path, 'HEAD'), 'damaged HEAD'); directory(join(path, 'objects')); directory(join(path, kind)); }
  }
  const result = discoverRepositories(f, forbidEnumeration(paths));
  assert.deepEqual(result.protectedRoots.sort(), ['refs', 'reftable', 'worktree']);
});

test('missing optional markers permit ordinary enumeration', t => {
  const f = fixture(t); directory(join(f.root, 'ordinary', 'child')); file(join(f.root, 'HEAD'));
  assert.deepEqual(discoverRepositories(f), { protectedRoots: [], directoryCount: 3 });
});

test('metadata comparison uses path components, not string prefixes', t => {
  const f = fixture(t); f.gitDirectory = join(f.root, '.git'); directory(f.gitDirectory);
  file(join(f.root, '.git-other', 'nested', '.git'));
  assert.deepEqual(discoverRepositories(f).protectedRoots.sort(), ['.git', '.git-other/nested']);
});
test('conventional current metadata is protected without enumeration or directory count', t => {
  const f = fixture(t); f.gitDirectory = f.commonDirectory = join(f.root, '.git'); directory(f.gitDirectory);
  assert.deepEqual(discoverRepositories(f, forbidEnumeration([f.gitDirectory])), { protectedRoots: ['.git'], directoryCount: 1 });
});

test('read failures and a disappeared queued directory do not return a result', t => {
  const f = fixture(t); directory(join(f.root, 'ordinary'));
  for (const [method, suffix, code] of [['readdirSync', 'ordinary', 'EACCES'], ['lstatSync', 'ordinary/.git', 'EIO'], ['lstatSync', 'ordinary', 'ENOENT']]) {
    let hits = 0;
    const adapter = { ...fs, [method](path, ...args) {
      if (resolve(path) === resolve(f.root, suffix) && (++hits > 1 || code !== 'ENOENT')) {
        throw Object.assign(new Error(`injected ${code}`), { code });
      }
      return fs[method](path, ...args);
    } };
    assert.throws(() => discoverRepositories(f, adapter), new RegExp(code));
  }
});

test('depth 64 is accepted and a marker is not a directory', t => {
  const f = fixture(t), deepest = join(f.root, ...Array(64).fill('d'));
  file(join(deepest, '.git'));
  const result = discoverRepositories(f);
  assert.equal(result.directoryCount, 65);
  assert.equal(result.protectedRoots.length, 1);
  fs.unlinkSync(join(deepest, '.git')); directory(join(deepest, 'overflow'));
  assert.throws(() => discoverRepositories(f), /depth limit.*64/);
});

test('exactly 10000 directories are accepted; 10001 are refused', t => {
  const f = fixture(t);
  // Use a virtual flat tree to test the bound without thousands of disk writes.
  let children = 9999;
  const adapter = { ...fs,
    readdirSync(path) { return path === f.root ? Array.from({ length: children }, (_, i) => Buffer.from(`d${i}`)) : []; },
    lstatSync(path) {
      if (path === join(f.root, 'd0', '.git')) return { isDirectory: () => false, isSymbolicLink: () => true };
      if (/[/\\]d\d+$/.test(path)) return { isDirectory: () => true, isSymbolicLink: () => false };
      if (/[/\\]d\d+[/\\]/.test(path)) throw Object.assign(new Error('missing marker'), { code: 'ENOENT' });
      return fs.lstatSync(path);
    }
  };
  const result = discoverRepositories(f, adapter);
  assert.equal(result.directoryCount, 10000);
  assert.deepEqual(result.protectedRoots, ['d0']);
  children++;
  assert.throws(() => discoverRepositories(f, adapter), /directory limit.*10000/);
});

function linkOrSkip(t, target, path, type) {
  try { fs.symlinkSync(target, path, type); return true; }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip(`Link creation is not supported: ${error.code}`); return false;
  }
}
for (const type of ['dir', ...(process.platform === 'win32' ? ['junction'] : [])]) {
  test(`${type} links are not followed`, t => {
    const f = fixture(t), outside = join(f.base, 'outside'); directory(outside);
    if (!linkOrSkip(t, outside, join(f.root, 'link'), type)) return;
    assert.equal(discoverRepositories(f, forbidEnumeration([outside, join(f.root, 'link')])).directoryCount, 1);
  });
}
test('dangling .git marker protects its parent before enumeration', t => {
  const f = fixture(t), nested = join(f.root, 'nested'); directory(nested);
  if (!linkOrSkip(t, join(f.base, 'absent'), join(nested, '.git'), 'file')) return;
  assert.deepEqual(discoverRepositories(f, forbidEnumeration([nested])).protectedRoots, ['nested']);
});
test('a dangling marker is protected even when link creation is not supported', t => {
  const f = fixture(t), nested = join(f.root, 'nested'); directory(nested);
  const adapter = { ...forbidEnumeration([nested]), lstatSync(path) {
    if (path === join(nested, '.git')) return { isDirectory: () => false, isSymbolicLink: () => true };
    return fs.lstatSync(path);
  } };
  assert.deepEqual(discoverRepositories(f, adapter).protectedRoots, ['nested']);
});
test('canonical metadata paths are excluded when supplied through a link', t => {
  const f = fixture(t), actual = join(f.root, 'admin'), alias = join(f.base, 'alias'); directory(actual);
  if (!linkOrSkip(t, actual, alias, process.platform === 'win32' ? 'junction' : 'dir')) return;
  f.gitDirectory = alias; f.commonDirectory = alias;
  assert.deepEqual(discoverRepositories(f, forbidEnumeration([actual])).protectedRoots, ['admin']);
});
test('bare repositories with linked storage are protected', t => {
  const f = fixture(t), nested = join(f.root, 'bare'), outside = join(f.base, 'objects'); directory(outside);
  file(join(nested, 'HEAD')); directory(join(nested, 'reftable'));
  if (!linkOrSkip(t, outside, join(nested, 'objects'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  assert.deepEqual(discoverRepositories(f, forbidEnumeration([nested])).protectedRoots, ['bare']);
});
test('literal unusual names remain intact', t => {
  const f = fixture(t), name = process.platform === 'win32' ? 'space [brackets]' : 'space : [brackets]\ttab\nline';
  file(join(f.root, name, '.git'));
  assert.deepEqual(discoverRepositories(f).protectedRoots, [name]);
});
test('case-variant markers protect nested roots', t => {
  const f = fixture(t); file(join(f.root, 'nested', '.GiT')); directory(join(f.root, 'nested', 'admin'));
  const adapter = process.platform === 'win32' ? forbidEnumeration([join(f.root, 'nested')]) : fs;
  assert.deepEqual(discoverRepositories(f, adapter).protectedRoots, ['nested']);
});
