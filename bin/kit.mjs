#!/usr/bin/env node
// Install or update the desk kit in a project.
//
//   node bin/kit.mjs <project>            install, or update to this checkout's kit
//   node bin/kit.mjs <project> --check    show what would change, change nothing
//   node bin/kit.mjs <project> --force    update even if kit files there have local edits
//
// The kit owns desks/desk.mjs, desks/kit/, desks/README.md, desks/.env.example and the
// desk and new-desk skills, and replaces them on update. It never touches a desk's own
// folder (desks/<name>/), desks/mail/ (the project's mail Worker settings), desks/.env,
// desks/data/, or what wrangler and npm leave in the kit's folders.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureGitignore } from '../template/desks/desk.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(REPO, 'template');
const OWNED = ['desks/desk.mjs', 'desks/README.md', 'desks/.env.example', 'desks/kit', '.claude/skills/desk', '.claude/skills/new-desk'];
const LINKS = { '.agents/skills/desk': '../../.claude/skills/desk', '.agents/skills/new-desk': '../../.claude/skills/new-desk' };

const args = process.argv.slice(2);
const check = args.includes('--check');
const force = args.includes('--force');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node bin/kit.mjs <project> [--check] [--force]');
  process.exit(1);
}
const PROJECT = path.resolve(target);
if (!fs.existsSync(PROJECT) || !fs.statSync(PROJECT).isDirectory()) {
  console.error(`error: ${PROJECT} is not a folder`);
  process.exit(1);
}
if (PROJECT === REPO) {
  console.error('error: that is the kit itself; give the project the desk is for');
  process.exit(1);
}

// Never the kit's, wherever they are: what wrangler and npm leave in a kit folder.
const LOCAL = new Set(['node_modules', '.wrangler', '.dev.vars']);

function files(root, rel) {
  const full = path.join(root, rel);
  if (LOCAL.has(path.basename(rel)) || !fs.existsSync(full)) return [];
  if (!fs.statSync(full).isDirectory()) return [rel];
  return fs.readdirSync(full).flatMap((f) => files(root, path.join(rel, f)));
}

function git(dir, ...a) {
  try {
    return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const want = new Map(OWNED.flatMap((p) => files(TEMPLATE, p)).map((f) => [f, fs.readFileSync(path.join(TEMPLATE, f))]));
const have = new Set(OWNED.flatMap((p) => files(PROJECT, p)).filter((f) => path.basename(f) !== 'VERSION'));
const added = [...want.keys()].filter((f) => !have.has(f));
const changed = [...want.keys()].filter((f) => have.has(f) && !fs.readFileSync(path.join(PROJECT, f)).equals(want.get(f)));
const removed = [...have].filter((f) => !want.has(f));
const links = Object.entries(LINKS).filter(([link]) => {
  const full = path.join(PROJECT, link);
  return !fs.existsSync(full) && !fs.lstatSync(full, { throwIfNoEntry: false });
});

const versionFile = path.join(PROJECT, 'desks/kit/VERSION');
const before = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;
const dirty = git(REPO, 'status', '--porcelain', '--', 'template') ? ' with uncommitted changes' : '';
const version = `${git(REPO, 'log', '-1', '--format=%h %cs') ?? 'unknown'}${dirty}`;

const show = (label, list) => { if (list.length) console.log(`${label}:\n${list.map((f) => `  ${f}`).join('\n')}`); };
console.log(`${before ? `Kit in ${PROJECT}: ${before}` : `No kit in ${PROJECT} yet`}. This kit: ${version}.`);
show('New', added);
show('Changed', changed);
show('Removed', removed);
show('Links for Codex', links.map(([l, t]) => `${l} -> ${t}`));
if (!added.length && !changed.length && !removed.length && !links.length) {
  if (!check && before && before !== version) fs.writeFileSync(versionFile, `${version}\n`);
  console.log('Already up to date.');
  process.exit(0);
}
if (check) process.exit(1);

// Local edits to kit files would be lost: stop unless told to go ahead.
const edited = git(PROJECT, 'status', '--porcelain', '--', ...OWNED);
if (edited && !force) {
  console.error(`\nThese kit files have uncommitted edits in the project, and updating would replace them:\n${edited}`);
  console.error('Commit or move the edits (desk-specific changes belong in desks/<name>/), or run again with --force.');
  process.exit(1);
}

for (const f of [...added, ...changed]) {
  fs.mkdirSync(path.dirname(path.join(PROJECT, f)), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, f), want.get(f));
}
for (const f of removed) fs.rmSync(path.join(PROJECT, f));
fs.chmodSync(path.join(PROJECT, 'desks/desk.mjs'), 0o755);
for (const [link, to] of links) {
  fs.mkdirSync(path.dirname(path.join(PROJECT, link)), { recursive: true });
  fs.symlinkSync(to, path.join(PROJECT, link));
}
fs.writeFileSync(versionFile, `${version}\n`);

ensureGitignore(path.join(PROJECT, 'desks'));

const coreChanged = changed.includes('desks/kit/core.sql');
console.log(`\nDone: ${added.length} new, ${changed.length} changed, ${removed.length} removed.`);
if (!before) {
  console.log('Next: say "set up a desk for ..." in Claude Code or Codex in that project, or run node desks/desk.mjs help.');
} else if (coreChanged) {
  console.log('The core schema changed: run node desks/desk.mjs init in the project (take a dump first if it is hosted).');
} else {
  console.log('Run node desks/desk.mjs doctor in the project to check everything still lines up.');
}
