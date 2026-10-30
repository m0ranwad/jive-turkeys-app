import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/functions.yml', import.meta.url), 'utf8');
const marker = '      - name: Deploy username sign-in, or remove it once its code is gone\n        run: |\n';
const step = workflow.split(marker)[1].split('\n').map((line) => line.slice(10)).join('\n');
const folders = [];
afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

function run({ listed = 'username-auth', listExit = 0, deleteExit = 0, present = false } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'jt-functions-'));
  folders.push(folder);
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  if (present) mkdirSync(join(folder, 'supabase/functions/username-auth'), { recursive: true });
  const calls = join(folder, 'calls');
  writeFileSync(calls, '');
  writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env bash
echo "$*" >> "$TEST_CALLS"
if [ "$1 $2" = 'functions list' ]; then
  printf '%s\\n' "$TEST_LISTED"
  exit "$TEST_LIST_EXIT"
fi
if [ "$1 $2" = 'functions delete' ]; then exit "$TEST_DELETE_EXIT"; fi
`, { mode: 0o755 });
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step], {
    cwd: folder, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PROJECT_REF: 'test-project',
      TEST_CALLS: calls, TEST_LISTED: listed, TEST_LIST_EXIT: String(listExit), TEST_DELETE_EXIT: String(deleteExit) },
  });
  return { ...result, calls: readFileSync(calls, 'utf8') };
}

describe('publishing or undoing the account service', () => {
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
