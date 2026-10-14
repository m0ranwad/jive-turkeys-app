// The team code a new account enters before it can see the team. The database
// enforces it (supabase/tests/membership.test.sql); these check the helpers and
// the demo backend (previews), which must behave the same way.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_LOGIN, DEMO_TEAM_CODE, createDemoBackend } from '@/api/demo';
import { codeIsStale, randomCode, sessionStartedAt } from '@/lib/team-code';

beforeEach(() => localStorage.clear());

describe('codes', () => {
  it('are six letters and numbers that are easy to read off a phone', () => {
    for (let i = 0; i < 50; i += 1) expect(randomCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(new Set(Array.from({ length: 50 }, () => randomCode())).size).toBeGreaterThan(45);
  });

  it('are flagged once a new session has started since the last change', () => {
    const rows = [
      { season_year: 2026, session: 2, created_date: '2026-10-20T12:00:00Z' },
      { season_year: 2026, session: 2, created_date: '2026-10-20T12:00:01Z' },
      { season_year: 2026, session: 1, created_date: '2026-09-01T12:00:00Z' },
    ];
    const roster = { current: { year: 2026, session: 2 }, rows };
    expect(sessionStartedAt(rows, roster.current)).toBe(Date.parse('2026-10-20T12:00:00Z'));
    expect(codeIsStale({ updated_date: '2026-09-15T00:00:00Z' }, roster)).toBe(true);
    expect(codeIsStale({ updated_date: '2026-10-21T00:00:00Z' }, roster)).toBe(false);
    expect(codeIsStale(null, roster)).toBe(false);
    expect(codeIsStale({ updated_date: '2026-09-15T00:00:00Z' }, null)).toBe(false);
  });
});

describe('the demo backend', () => {
  async function newAccount(email = 'zed@demo.test') {
    const api = createDemoBackend();
    await api.auth.signUp(email, 'demo1234');
    return api;
  }

  it('lets players already on the team in, and asks new accounts for the code', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    expect(await api.auth.me()).toMatchObject({ joined: true });
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    expect(await api.auth.me()).toMatchObject({ joined: true });
    await api.auth.signIn('nia@demo.test', 'demo1234');
    expect(await api.auth.me()).toMatchObject({ joined: false });
    expect(await (await newAccount()).auth.me()).toMatchObject({ joined: false });
  });

  it('turns a wrong code away, and lets the right one in (any case, spaces ignored)', async () => {
    const api = await newAccount();
    await expect(api.users.joinTeam('NOPE')).rejects.toThrow("That code isn't right");
    await api.users.joinTeam(` ${DEMO_TEAM_CODE.toLowerCase()} `);
    expect(await api.auth.me()).toMatchObject({ joined: true });
  });

  it('blocks more tries after ten wrong codes in a row, even the right one', async () => {
    const api = await newAccount();
    for (let i = 1; i < 10; i += 1) await expect(api.users.joinTeam(`guess${i}`)).rejects.toThrow("isn't right");
    await expect(api.users.joinTeam('guess10')).rejects.toThrow('Too many tries');
    await expect(api.users.joinTeam(DEMO_TEAM_CODE)).rejects.toThrow('Too many tries');
    expect(await api.auth.me()).toMatchObject({ joined: false });
  });

  it('stops taking the old code once a captain changes it', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const [row] = await api.entities.TeamJoinCode.list();
    expect(row.code).toBe(DEMO_TEAM_CODE);
    await api.entities.TeamJoinCode.update(row.id, { code: 'GOBBLE2' });

    const late = await newAccount('late@demo.test');
    await expect(late.users.joinTeam(DEMO_TEAM_CODE)).rejects.toThrow("isn't right");
    await late.users.joinTeam('gobble2');
    expect(await late.auth.me()).toMatchObject({ joined: true });
  });
});
