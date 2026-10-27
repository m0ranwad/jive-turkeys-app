import { afterEach, expect, it, vi } from 'vitest';
import { createSettingsAutosave } from '@/lib/settings-autosave';

afterEach(() => vi.useRealTimers());

it('saves the latest choice after an earlier slow write, including a return to the original value', async () => {
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  let stored = { potm_notify: true, potm_window_hours: 24, potm_reminder_hours: 12 };
  let calls = 0;
  const editor = createSettingsAutosave(stored, {
    save: async (patch) => {
      if (++calls === 1) await first;
      stored = { ...stored, ...patch };
    },
  });
  let visible;
  editor.subscribe((snapshot) => { visible = snapshot; });
  const saving = editor.change({ potm_notify: false }, true);
  await Promise.resolve();
  editor.change({ potm_notify: true }, true);
  expect(visible.form.potm_notify).toBe(true);
  expect(visible.status).toBe('saving');
  editor.change({ potm_window_hours: 6, potm_reminder_hours: 3 }, true);
  release();
  await saving;
  expect(stored).toEqual({ potm_notify: true, potm_window_hours: 6, potm_reminder_hours: 3 });
  expect(editor.isDirty()).toBe(false);
});

it('saves focused typing after a pause without blur, with the same field cleaning', async () => {
  vi.useFakeTimers();
  let stored = { season_label: 'Winter', min_players: 8 };
  const editor = createSettingsAutosave(stored, { save: async (patch) => { stored = { ...stored, ...patch }; } });
  editor.change({ season_label: ' New season ', min_players: '12' });
  await vi.advanceTimersByTimeAsync(400);
  expect(stored).toEqual({ season_label: 'New season', min_players: 12 });
  expect(editor.isDirty()).toBe(false);
});

it('keeps a failed field unsaved even after another field succeeds, and retries the retained draft', async () => {
  let stored = { primary_jersey: 'Lime', backup_jersey: 'Black', venue_name: 'Arena' };
  let offline = false;
  let status;
  const editor = createSettingsAutosave(stored, {
    save: async (patch) => {
      if (offline) throw new Error('offline');
      stored = { ...stored, ...patch };
    },
  });
  editor.subscribe((snapshot) => { status = snapshot.status; });
  await editor.change({ primary_jersey: 'Yellow' }, true);
  expect(status).toBe('saved');
  offline = true;
  await editor.change({ backup_jersey: 'Navy' }, true);
  expect(status).toBe('error');
  offline = false;
  await editor.change({ venue_name: 'New arena' }, true);
  expect(status).toBe('error');
  expect(stored.backup_jersey).toBe('Black');
  await editor.retry();
  expect(stored.backup_jersey).toBe('Navy');
  expect(status).toBe('saved');
});
