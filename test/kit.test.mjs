// Tests for bin/kit.mjs, the installer, run on a copy of the kit so the real template is
// never touched.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kit-test-${name}-`));
  dirs.push(dir);
  return dir;
}
const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

const git = (dir, ...a) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
// What wrangler and npm leave, which the kit never ships, removes or lets into git.
const LOCAL = ['node_modules', '.wrangler', '.dev.vars'];

// A copy of the kit, with what running wrangler and npm in its mail folder would leave there.
function kitCopy() {
  const kit = tmp('repo');
  for (const d of ['bin', 'template']) fs.cpSync(path.join(REPO, d), path.join(kit, d), { recursive: true });
  const mail = path.join(kit, 'template/desks/kit/mail');
  write(path.join(mail, 'node_modules/wrangler/index.js'));
  write(path.join(mail, '.wrangler/state/v3/d1/db.sqlite'));
  write(path.join(mail, '.dev.vars'), 'MAIL_API_TOKEN=secret\n');
  const run = (project, ...args) => spawnSync(process.execPath, [path.join(kit, 'bin/kit.mjs'), project, ...args], { encoding: 'utf8' });
  run.template = path.join(kit, 'template');
  return run;
}

// A git project with work of its own in progress.
function gitProject() {
  const project = tmp('project');
  git(project, 'init', '-q');
  write(path.join(project, 'src/app.js'), 'work in progress');
  return project;
}

test('install skips what wrangler and npm leave in the kit, and keeps it out of git', () => {
  const kit = kitCopy();
  const project = gitProject();
  const r = kit(project);
  assert.equal(r.status, 0, `the project's own uncommitted work doesn't stop a first install:\n${r.stderr}`);
  const mail = path.join(project, 'desks/kit/mail');
  assert.ok(fs.existsSync(path.join(mail, 'src/index.js')), 'the Worker is installed');
  for (const f of LOCAL) {
    assert.ok(!fs.existsSync(path.join(mail, f)), `${f} is not copied`);
    assert.ok(!r.stdout.includes(f), `${f} is not listed`);
  }
  assert.equal(fs.readFileSync(path.join(project, 'desks/.gitignore'), 'utf8'), ['data', '.env', ...LOCAL, ''].join('\n'));
});

test('update leaves wrangler and npm files in the project alone, and adds the ignore lines once', () => {
  const kit = kitCopy();
  const project = gitProject();
  write(path.join(project, 'desks/.gitignore'), 'data\n.env\nscratch');
  assert.equal(kit(project).status, 0);
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', 'kit');
  const local = [
    'desks/kit/mail/node_modules/x.js',
    'desks/kit/mail/.wrangler/state.json',
    'desks/kit/mail/.dev.vars',
    'desks/mail/.dev.vars',
    'desks/mail/.wrangler/state.json',
  ];
  for (const f of local) write(path.join(project, f));
  write(path.join(project, 'desks/mail/wrangler.jsonc'), '{}');

  const check = kit(project, '--check');
  assert.equal(check.status, 0, check.stdout);
  assert.match(check.stdout, /Already up to date/);
  fs.appendFileSync(path.join(kit.template, 'desks/README.md'), '\nA newer kit.\n');
  const update = kit(project);
  assert.equal(update.status, 0, `ignored local files are not edits to the kit:\n${update.stderr}`);
  assert.match(update.stdout, /Changed:\n {2}desks\/README\.md\n/);
  for (const f of [...local, 'desks/mail/wrangler.jsonc']) assert.ok(fs.existsSync(path.join(project, f)), `${f} is kept`);
  assert.equal(fs.readFileSync(path.join(project, 'desks/.gitignore'), 'utf8'), ['data', '.env', 'scratch', ...LOCAL, ''].join('\n'));
});
