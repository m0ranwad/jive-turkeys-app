import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, DEMO_LOGIN, DEMO_PLAYER_LOGIN } from '@/api/demo';
import { photoMessage } from '@/lib/chat';

beforeEach(() => localStorage.clear());

describe('demo photo upload', () => {
  it('uploads and posts a photo message', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const me = await api.auth.me();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    const uploaded = await api.chat.uploadPhoto(blob, { ext: 'jpg', width: 64, height: 48 });
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

  it('refuses a photo URL for a path no readable message shows', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const me = await api.auth.me();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    const uploaded = await api.chat.uploadPhoto(blob, { ext: 'jpg', width: 32, height: 24 });
    // Own folder is readable before the message posts.
    expect(await api.chat.photoUrl(uploaded.path)).toMatch(/^data:/);

    await api.auth.signOut();
    await api.auth.signIn(DEMO_PLAYER_LOGIN.email, DEMO_PLAYER_LOGIN.password);
    await expect(api.chat.photoUrl(uploaded.path)).rejects.toThrow();
    // The seeded Team Chat photo is readable to teammates.
    const rows = await api.entities.Message.filter({ thread_id: null });
    const photo = rows.find((m) => m.attachments?.[0]?.type === 'image');
    expect(photo).toBeTruthy();
    expect(await api.chat.photoUrl(photo.attachments[0].path)).toMatch(/demo-photos|data:/);
    expect(me.id).toBeTruthy();
  });
});
