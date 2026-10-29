import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatDraft, chatOutbox, clearChatLocal, keepDraft, keepOutbox, sendChatMessage } from '@/lib/chat-local';

beforeEach(() => {
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value(key) { return this[key] ?? null; } },
    setItem: { value(key, value) { this[key] = String(value); } },
    removeItem: { value(key) { delete this[key]; } },
  });
  vi.stubGlobal('localStorage', storage);
  clearChatLocal();
});

const message = { id: 'same-message', user_id: 'casey', thread_id: null, body: 'Kickoff is at 8', author_name: 'Casey', reply_to_id: null };

describe('words kept on this device', () => {
  it('restores drafts after a reload, separately for each player and room', async () => {
    keepDraft('casey', 'team', 'For the team');
    keepDraft('casey', 'private', 'For Jordan');
    vi.resetModules();
    const reloaded = await import('@/lib/chat-local');
    expect(reloaded.chatDraft('casey', 'team')).toBe('For the team');
    expect(reloaded.chatDraft('casey', 'private')).toBe('For Jordan');
    expect(reloaded.chatDraft('jordan', 'team')).toBe('');
  });

  it('keeps unconfirmed messages as manual retries after a reload', async () => {
    keepOutbox('casey', [{ ...message, failed: false }]);
    vi.resetModules();
    const reloaded = await import('@/lib/chat-local');
    expect(reloaded.chatOutbox('casey')).toEqual([{ ...message, pending: true, failed: true }]);
    expect(reloaded.chatOutbox('jordan')).toEqual([]);
    keepOutbox('casey', []);
    expect(chatOutbox('casey')).toEqual([]);
  });

  it('clears drafts and unsent messages on sign-out, keeping unrelated site settings', () => {
    keepDraft('casey', 'team', 'A draft');
    keepOutbox('casey', [message]);
    localStorage.setItem('jt_chat_tip_seen', '1');
    clearChatLocal();
    expect(chatDraft('casey', 'team')).toBe('');
    expect(chatOutbox('casey')).toEqual([]);
    expect(localStorage.getItem('jt_chat_tip_seen')).toBe('1');
  });

  it('keeps this visit usable when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } });
    keepDraft('casey', 'team', 'Still here');
    keepOutbox('casey', [message]);
    expect(chatDraft('casey', 'team')).toBe('Still here');
    expect(chatOutbox('casey')[0].body).toBe(message.body);
  });
});

describe('safe sending and retries', () => {
  it('accepts a saved message when only its response was lost, using the original ID', async () => {
    const api = { entities: { Message: { create: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')), filter: vi.fn().mockResolvedValue([message]) } } };
    expect(await sendChatMessage(api, message)).toEqual(message);
    expect(api.entities.Message.create.mock.calls[0][0].id).toBe(message.id);
    expect(api.entities.Message.filter).toHaveBeenCalledWith({ id: message.id, user_id: message.user_id });
  });

  it('keeps a real failure available for retry and rejects a message from a different room', async () => {
    const error = new TypeError('Failed to fetch');
    const api = { entities: { Message: { create: vi.fn().mockRejectedValue(error), filter: vi.fn().mockResolvedValue([{ ...message, thread_id: 'another-room' }]) } } };
    await expect(sendChatMessage(api, message)).rejects.toBe(error);
    api.entities.Message.filter.mockRejectedValue(Error('Still offline'));
    await expect(sendChatMessage(api, message)).rejects.toBe(error);
  });
});
