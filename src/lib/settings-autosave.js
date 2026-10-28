// Keep only changed fields in each write, and never send a newer write before
// the previous one finishes. Drafts (including a change back to the old value)
// are independent of the value currently being saved.
const CLEAN = {
  season_label: (v) => v?.trim() || null,
  min_players: (v) => Number(v) || 0,
  min_women: (v) => Number(v) || 0,
  potm_window_hours: Number,
  potm_reminder_hours: Number,
  game_reminder_hours: Number,
  potm_notify: Boolean,
  potm_announce: Boolean,
  game_reminders: Boolean,
};
const clean = (patch) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, CLEAN[k] ? CLEAN[k](v) : v]));

export function createSettingsAutosave(initial, { save, onSaved = () => {}, onError = () => {}, delay = 400 }) {
  let form = { ...initial };
  let saved = clean(initial);
  let pending = {};
  let timer = null;
  let flight = null;
  let failed = false;
  let savedAny = false;
  const listeners = new Set();
  const isDirty = () => Object.entries(clean(form)).some(([key, value]) => value !== saved[key]);
  const publish = () => {
    const dirty = isDirty();
    if (!dirty) failed = false;
    const status = flight || timer || Object.keys(pending).length ? 'saving'
      : dirty ? (failed ? 'error' : 'dirty') : savedAny ? 'saved' : 'idle';
    for (const listener of listeners) listener({ form, status });
  };

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (flight) {
      publish();
      return flight;
    }
    if (!Object.keys(pending).length) {
      publish();
      return Promise.resolve();
    }

    flight = Promise.resolve().then(async () => {
      while (Object.keys(pending).length) {
        clearTimeout(timer);
        timer = null;
        const values = Object.fromEntries(Object.entries(clean(pending)).filter(([key, value]) => value !== saved[key]));
        pending = {};
        if (!Object.keys(values).length) continue;
        try {
          await save(values);
          saved = { ...saved, ...values };
          savedAny = true;
        } catch (error) {
          failed = true;
          onError(error);
          continue;
        }
        // Refreshing another screen must not turn a successful write into a
        // failed save, or prevent the next queued edit from being written.
        await onSaved();
      }
    }).finally(() => {
      flight = null;
      publish();
    });
    publish();
    return flight;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      publish();
      return () => listeners.delete(listener);
    },
    hasSubscribers: () => listeners.size > 0,
    isDirty,
    change(patch, immediate = false) {
      form = { ...form, ...patch };
      pending = { ...pending, ...patch };
      clearTimeout(timer);
      timer = null;
      if (immediate) return flush();
      timer = setTimeout(flush, delay);
      publish();
    },
    retry() {
      pending = { ...pending, ...Object.fromEntries(Object.entries(clean(form)).filter(([key, value]) => value !== saved[key])) };
      return flush();
    },
    flush,
  };
}
