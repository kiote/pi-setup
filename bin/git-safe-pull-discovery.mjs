#!/usr/bin/env node
// Read-only preflight for git-safe-pull.sh. See specs/git-safe-pull.md.
import * as fs from 'node:fs';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DIRECTORIES = 10000;
const MAX_DEPTH = 64;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// The adapter permits read-failure and non-entry tests. The CLI always uses node:fs.
export function discoverRepositories({ root, gitDirectory, commonDirectory }, filesystem = fs) {
  for (const path of [root, gitDirectory, commonDirectory]) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('discovery requires absolute paths');
  }
  const key = path => {
    const normalized = normalize(resolve(path));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const metadataPaths = [gitDirectory, commonDirectory].flatMap(path => [resolve(path), filesystem.realpathSync(path)]);
  const excluded = new Set(metadataPaths.map(key));
  root = resolve(root);
  const canonicalRoot = filesystem.realpathSync(root);
  const metadataRoots = new Set();
  for (const path of metadataPaths) {
    for (const base of [root, canonicalRoot]) {
      const inside = relative(base, path);
      if (!inside) throw new Error('repository root is also Git metadata');
      if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`)) {
        metadataRoots.add(inside.split(sep).join('/'));
        break;
      }
    }
  }
  const optional = path => {
    try { return filesystem.lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const storage = stat => stat && (stat.isDirectory() || stat.isSymbolicLink());
  // Excluded metadata is protected too: Git status can list relocated metadata.
  // These roots do not contribute to the traversal directory count.
  const protectedRoots = [...metadataRoots];
  let directoryCount = 0;
  const stack = [{ path: root, depth: 0 }];
  while (stack.length) {
    const { path, depth } = stack.pop();
    const relativePath = relative(root, path);
    // Check both spellings when the checkout itself has a linked ancestor.
    if (excluded.has(key(path)) || excluded.has(key(resolve(canonicalRoot, relativePath)))) continue;
    const stat = filesystem.lstatSync(path); // A queued directory must still exist.
    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory()) throw new Error('discovery directory changed type');
    if (depth > MAX_DEPTH) throw new Error('repository discovery depth limit (64) exceeded');
    if (++directoryCount > MAX_DIRECTORIES) throw new Error('repository discovery directory limit (10000) exceeded');
    if (depth && (optional(resolve(path, '.git')) ||
      (optional(resolve(path, 'HEAD')) && storage(optional(resolve(path, 'objects'))) &&
        (storage(optional(resolve(path, 'refs'))) || storage(optional(resolve(path, 'reftable'))))))) {
      protectedRoots.push(relativePath.split(sep).join('/'));
      continue;
    }
    const names = filesystem.readdirSync(path, { encoding: 'buffer' }).map(bytes => {
      const name = bytes.toString('utf8');
      if (!Buffer.from(name).equals(bytes)) throw new Error('discovery filename is not valid UTF-8');
      return name;
    });
    // Windows lstat above finds case variants before enumeration. On other systems,
    // protect a case-variant marker before opening any child of this directory.
    if (depth && names.some(name => name.toLowerCase() === '.git')) {
      protectedRoots.push(relativePath.split(sep).join('/'));
      continue;
    }
    for (const name of names) {
      const child = resolve(path, name);
      if (excluded.has(key(child)) || excluded.has(key(resolve(canonicalRoot, relative(root, child))))) continue;
      const childStat = filesystem.lstatSync(child);
      if (childStat.isDirectory() && !childStat.isSymbolicLink()) stack.push({ path: child, depth: depth + 1 });
    }
  }
  return { protectedRoots, directoryCount };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('usage: git-safe-pull-discovery.mjs <root> <git-directory> <common-directory>');
    const [root, gitDirectory, commonDirectory] = process.argv.slice(2);
    const { protectedRoots, directoryCount } = discoverRepositories({ root, gitDirectory, commonDirectory });
    // Emit no records until the whole scan is complete. Paths are separate NUL fields.
    const fields = ['git-safe-pull-discovery-v1', 'root', '.',
      ...protectedRoots.flatMap(path => ['protected', path]), 'complete', String(directoryCount), String(protectedRoots.length)];
    const output = fields.join('\0') + '\0';
    if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) throw new Error('repository discovery output limit exceeded');
    process.stdout.write(output);
  } catch (error) {
    console.error(`git-safe-pull: ${error.message}`);
    process.exitCode = 1;
  }
}
