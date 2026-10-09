// The notification sender's encryption and signing, checked against
// independent implementations: http_ece (by the author of the Web Push
// encryption standard) decrypts what we encrypt, and Node's own crypto
// verifies our signed VAPID tokens.
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it, vi } from 'vitest';
import {
  b64u,
  encryptPayload,
  generateVapidKeys,
  sendPush,
  vapidAuthorization,
} from '../../supabase/functions/_shared/webpush.js';

/** A phone's side of a push subscription: its key pair and auth secret. */
function fakePhone() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, p256dh: b64u.encode(ecdh.getPublicKey()), auth: b64u.encode(auth) };
}

const open = (phone, body) =>
  ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: phone.ecdh, authSecret: phone.auth }).toString();

function readToken(header) {
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, c, s] = token.split('.');
  return {
    token,
    key,
    header: JSON.parse(Buffer.from(h, 'base64url')),
    claims: JSON.parse(Buffer.from(c, 'base64url')),
    signed: `${h}.${c}`,
    signature: s,
  };
}

describe('base64url', () => {
  it('round-trips bytes, with no padding or URL-unsafe characters', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 62, 63]);
    const text = b64u.encode(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(b64u.decode(text)).toEqual(bytes);
  });
});

describe('encryptPayload', () => {
  it('produces a message only the subscribed phone can read', async () => {
    const phone = fakePhone();
    const body = await encryptPayload({
      payload: '{"title":"Team Chat","body":"Jordan R.: In 🦃"}',
      p256dh: phone.p256dh,
      auth: phone.auth,
    });
    expect(open(phone, body)).toBe('{"title":"Team Chat","body":"Jordan R.: In 🦃"}');

    const stranger = fakePhone();
    expect(() => open({ ...stranger, auth: phone.auth }, body)).toThrow();
    expect(() => open({ ...phone, auth: stranger.auth }, body)).toThrow();
  });

  it('uses a fresh salt and key every time, so equal messages look different', async () => {
    const phone = fakePhone();
    const a = await encryptPayload({ payload: 'same', p256dh: phone.p256dh, auth: phone.auth });
    const b = await encryptPayload({ payload: 'same', p256dh: phone.p256dh, auth: phone.auth });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(open(phone, a)).toBe('same');
    expect(open(phone, b)).toBe('same');
  });

  it('writes the aes128gcm header: salt, 4096 record size, and its own public key', async () => {
    const phone = fakePhone();
    const body = await encryptPayload({ payload: 'x', p256dh: phone.p256dh, auth: phone.auth });
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(4); // uncompressed P-256 point
    expect(body.length).toBe(16 + 4 + 1 + 65 + 1 + 1 + 16); // header + 1 byte + delimiter + tag
  });

  it('refuses messages too big for a push (4 KB)', async () => {
    const phone = fakePhone();
    await expect(encryptPayload({ payload: 'x'.repeat(3994), p256dh: phone.p256dh, auth: phone.auth })).rejects.toThrow(
      /too large/,
    );
    expect(open(phone, await encryptPayload({ payload: 'x'.repeat(3993), p256dh: phone.p256dh, auth: phone.auth }))).toHaveLength(
      3993,
    );
  });
});

describe('VAPID', () => {
  it('makes key pairs in the form browsers and push services expect', async () => {
    const keys = await generateVapidKeys();
    expect(b64u.decode(keys.publicKey)).toHaveLength(65);
    expect(b64u.decode(keys.publicKey)[0]).toBe(4);
    expect(b64u.decode(keys.privateKey)).toHaveLength(32);
  });

  it('signs a token for the push service that verifies with our public key', async () => {
    const keys = await generateVapidKeys();
    const now = Date.UTC(2026, 9, 10, 12);
    const header = await vapidAuthorization({
      endpoint: 'https://web.push.apple.com/QGuQyavXutnMH',
      subject: 'mailto:team@jiveturkeys.app',
      ...keys,
      now,
    });
    const t = readToken(header);
    expect(t.key).toBe(keys.publicKey);
    expect(t.header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(t.claims).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'mailto:team@jiveturkeys.app',
    });

    const raw = b64u.decode(keys.publicKey);
    const publicKey = createPublicKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: b64u.encode(raw.slice(1, 33)), y: b64u.encode(raw.slice(33)) },
    });
    const ok = verify(
      'sha256',
      Buffer.from(t.signed),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(t.signature, 'base64url'),
    );
    expect(ok).toBe(true);
    // A different key doesn't verify it.
    const other = await generateVapidKeys();
    const otherRaw = b64u.decode(other.publicKey);
    const otherKey = createPublicKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: b64u.encode(otherRaw.slice(1, 33)), y: b64u.encode(otherRaw.slice(33)) },
    });
    expect(
      verify(
        'sha256',
        Buffer.from(t.signed),
        { key: otherKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(t.signature, 'base64url'),
      ),
    ).toBe(false);
  });

  it('rejects a malformed public key', async () => {
    const keys = await generateVapidKeys();
    await expect(
      vapidAuthorization({
        endpoint: 'https://fcm.googleapis.com/x',
        subject: 'mailto:a@b.c',
        publicKey: keys.privateKey,
        privateKey: keys.privateKey,
      }),
    ).rejects.toThrow(/public key/);
  });
});

describe('sendPush', () => {
  const vapidKeys = generateVapidKeys();

  async function sendWith(status) {
    const phone = fakePhone();
    const fetch = vi.fn(async () => new Response(null, { status }));
    const vapid = { ...(await vapidKeys), subject: 'mailto:team@jiveturkeys.app' };
    const result = await sendPush(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: phone.p256dh, auth: phone.auth },
      { title: 'Team Chat', body: 'Hi' },
      vapid,
      { fetch },
    );
    return { result, phone, call: fetch.mock.calls[0] };
  }

  it('posts the encrypted notification with the headers push services require', async () => {
    const { result, phone, call } = await sendWith(201);
    expect(result).toEqual({ ok: true, status: 201, gone: false });
    const [url, init] = call;
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/abc');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400', Urgency: 'high' });
    expect(readToken(init.headers.Authorization).claims.aud).toBe('https://fcm.googleapis.com');
    expect(JSON.parse(open(phone, init.body))).toEqual({ title: 'Team Chat', body: 'Hi' });
  });

  it('flags subscriptions that are gone (404/410), but not other failures', async () => {
    expect((await sendWith(410)).result.gone).toBe(true);
    expect((await sendWith(404)).result.gone).toBe(true);
    expect((await sendWith(429)).result).toEqual({ ok: false, status: 429, gone: false });
    expect((await sendWith(500)).result.gone).toBe(false);
  });
});
