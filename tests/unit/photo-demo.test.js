import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, DEMO_LOGIN } from '@/api/demo';
import { photoMessage } from '@/lib/chat';

beforeEach(() => localStorage.clear());

describe('demo photo upload', () => {
  it('uploads and posts a photo message', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const me = await api.auth.me();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
    const uploaded = await api.chat.uploadPhoto(blob, { ext: 'webp', width: 64, height: 48 });
    expect(uploaded.path.startsWith(`${me.id}/`)).toBe(true);
    const { body, attachments } = photoMessage(uploaded, 'Look at this!');
    const created = await api.entities.Message.create({
      user_id: me.id,
      author_name: 'Casey',
      body,
      thread_id: null,
      attachments,
    });
    expect(created.attachments[0].type).toBe('image');
    expect(await api.chat.photoUrl(uploaded.path)).toMatch(/^data:/);
  });
});
