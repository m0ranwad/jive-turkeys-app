import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(repo, '.github/workflows/functions.yml'), 'utf8');

// The shell script of the step with this name: the `run: |` block, up to the
// first line indented no deeper than `run:`, with its own indentation removed.
function stepScript(name) {
  const lines = workflow.split('\n');
  const indent = (line) => line.search(/\S/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`No step named ${name}`);
  const end = lines.findIndex((line, i) => i > start && line.trim() && indent(line) <= indent(lines[start]));
  const step = lines.slice(start + 1, end < 0 ? undefined : end);
  const run = step.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  if (run < 0) throw new Error(`Step ${name} has no run block`);
  const body = [];
  for (const line of step.slice(run + 1)) {
    if (line.trim() && indent(line) <= indent(step[run])) break;
    body.push(line);
  }
  const margin = Math.min(...body.filter((line) => line.trim()).map(indent));
  return body.map((line) => line.slice(margin)).join('\n');
}

const folders = [];
afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

// Runs a bash script with stand-in commands (name -> script body) first on PATH.
function runWithStandIns(args, standIns, { cwd, env = {} } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'jt-functions-'));
  folders.push(folder);
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  const calls = join(folder, 'calls');
  writeFileSync(calls, '');
  for (const [name, body] of Object.entries(standIns)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\necho "$*" >> "$TEST_CALLS"\n${body}`, { mode: 0o755 });
  }
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', ...args], {
    cwd: cwd ?? folder, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_CALLS: calls, ...env },
  });
  return { ...result, folder, calls: readFileSync(calls, 'utf8') };
}

// These steps only ever run on GitHub's Linux runners, and need bash.
describe.skipIf(process.platform === 'win32')('publishing or undoing the account service', () => {
  const step = stepScript('Deploy username sign-in, or remove it once its code is gone');
  const supabase = `
if [ "$1 $2" = 'functions list' ]; then
  printf '%s\\n' "$TEST_LISTED"
  exit "$TEST_LIST_EXIT"
fi
if [ "$1 $2" = 'functions delete' ]; then exit "$TEST_DELETE_EXIT"; fi
`;
  function run({ listed = 'username-auth', listExit = 0, deleteExit = 0, present = false } = {}) {
    const cwd = mkdtempSync(join(tmpdir(), 'jt-repo-'));
    folders.push(cwd);
    if (present) mkdirSync(join(cwd, 'supabase/functions/username-auth'), { recursive: true });
    return runWithStandIns(['-c', step], { supabase }, {
      cwd,
      env: { PROJECT_REF: 'test-project', TEST_LISTED: listed, TEST_LIST_EXIT: String(listExit), TEST_DELETE_EXIT: String(deleteExit) },
    });
  }

  it('reads exactly the step, however many steps follow it', () => {
    expect(step.startsWith('if [ -d supabase/functions/username-auth ]; then')).toBe(true);
    expect(step).not.toMatch(/- name:|run: \|/);
  });

  it('publishes when the function folder exists', () => {
    const result = run({ present: true });
    expect(result.status).toBe(0);
    expect(result.calls).toBe('functions deploy username-auth --project-ref test-project --use-api\n');
  });

  it('removes the function after an undo, or skips it if it is already absent', () => {
    const found = run();
    expect(found.status).toBe(0);
    expect(found.calls).toContain('functions delete username-auth');
    const absent = run({ listed: '' });
    expect(absent.status).toBe(0);
    expect(absent.calls).not.toContain('functions delete');
  });

  it.each(['', 'username-auth'])('fails if listing functions fails, even with partial output: %j', (listed) => {
    const result = run({ listed, listExit: 17 });
    expect(result.status).toBe(17);
    expect(result.calls).not.toContain('functions delete');
    expect(result.stdout).not.toContain("isn't on Supabase");
  });

  it('reports a failed deletion', () => {
    expect(run({ deleteExit: 23 }).status).toBe(23);
  });
});

describe.skipIf(process.platform === 'win32')('waiting for the database before deploying', () => {
  const versions = readdirSync(join(repo, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).map((f) => f.split('_')[0]);
  // A stand-in psql that reports the versions in TEST_APPLIED_FILE. It fails
  // once if the .fail file is there, and every time if the list is missing.
  const psql = `
if [ -f "$TEST_APPLIED_FILE.fail" ]; then rm "$TEST_APPLIED_FILE.fail"; echo 'connection reset' >&2; exit 2; fi
[ -f "$TEST_APPLIED_FILE" ] || { echo 'connection refused' >&2; exit 2; }
cat "$TEST_APPLIED_FILE"
`;
  function wait(applied, env = {}, { failOnce = false } = {}) {
    const folder = mkdtempSync(join(tmpdir(), 'jt-applied-'));
    folders.push(folder);
    const file = join(folder, 'applied');
    if (applied) writeFileSync(file, applied.join('\n'));
    if (failOnce) writeFileSync(`${file}.fail`, '');
    return runWithStandIns([join(repo, 'scripts/wait-for-database.sh')], { psql, sleep: '' }, {
      env: { SUPABASE_DB_URL: 'postgres://test', TEST_APPLIED_FILE: file, WAIT_SECONDS: '0', POLL_SECONDS: '0', ...env },
    });
  }

  it('the deploy steps come after the wait', () => {
    const order = ['Wait for this commit\'s database updates', 'Deploy the notification sender',
      'Deploy username sign-in, or remove it once its code is gone'].map((name) => workflow.indexOf(`- name: ${name}`));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))).toBe(true);
    expect(workflow).toContain('run: bash scripts/wait-for-database.sh');
  });

  it('goes ahead once every database update is applied', () => {
    const result = wait([...versions, '19990101000000']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('has every database update');
  });

  it('stops, deploying nothing, while an update is missing', () => {
    const result = wait(versions.slice(0, -1));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(versions.at(-1));
    expect(result.stdout).toContain('nothing new was deployed');
  });

  it('tries again when the database cannot be read, and stops if it never can', () => {
    const recovered = wait(versions, { WAIT_SECONDS: '60' }, { failOnce: true });
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain("Couldn't read the live database's updates; trying again.");
    expect(recovered.calls.split('\n').filter((line) => line.includes('schema_migrations'))).toHaveLength(2);
    expect(wait(null).status).toBe(1);
  });

  it('needs the database address', () => {
    expect(wait(versions, { SUPABASE_DB_URL: '' }).status).not.toBe(0);
  });
});
