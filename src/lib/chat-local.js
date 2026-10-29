// Unsent words stay on this device, separately for each player. Nothing here sends automatically.
const PREFIX = 'jt_chat_local_v1:';
const memory = new Map();
const keyFor = (user, kind, room = '') => `${PREFIX}${user}:${kind}:${room ?? 'team'}`;

function read(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return JSON.parse(saved);
  } catch {
    // Storage can be unavailable in private browsing; keep this visit's words in memory.
  }
  return memory.get(key) ?? fallback;
}

function write(key, value) {
  memory.set(key, value);
  try {
    if (value === '' || (Array.isArray(value) && !value.length)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory copy still works when storage is unavailable or full.
  }
}

export function chatDraft(user, room) {
  if (!user) return '';
  const value = read(keyFor(user, 'draft', room), '');
  return typeof value === 'string' ? value : '';
}

export function keepDraft(user, room, text) {
  if (user) write(keyFor(user, 'draft', room), text);
}

export function chatOutbox(user) {
  if (!user) return [];
  const saved = read(keyFor(user, 'outbox'), []);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((m) => m.user_id === user && typeof m.id === 'string' && typeof m.body === 'string')
    .map((m) => ({ ...m, pending: true, failed: true }));
}

export function keepOutbox(user, messages) {
  if (user) write(keyFor(user, 'outbox'), messages);
}

export function clearChatLocal() {
  memory.clear();
  try {
    Object.keys(localStorage).filter((key) => key.startsWith(PREFIX)).forEach((key) => localStorage.removeItem(key));
  } catch {
    // Nothing persisted on this device.
  }
}

/** Reuse the same ID on every attempt, including when a saved message's response was lost. */
export async function sendChatMessage(api, message) {
  const { id, user_id, author_name, body, thread_id, reply_to_id, mentions, mentions_team } = message;
  try {
    return await api.entities.Message.create({ id, user_id, author_name, body, thread_id, reply_to_id, mentions, mentions_team });
  } catch (error) {
    try {
      const [saved] = await api.entities.Message.filter({ id, user_id });
      if (saved && (saved.thread_id ?? null) === (thread_id ?? null)) return saved;
    } catch {
      // The original error explains why the message still needs a retry.
    }
    throw error;
  }
}
