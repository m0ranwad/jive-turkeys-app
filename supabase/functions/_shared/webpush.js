// Web Push, with nothing but the standard Web Crypto API, so the same code runs
// in Supabase's Edge Functions (Deno), in Node for the tests, and anywhere else.
//
// - VAPID (RFC 8292): an ES256-signed token telling the phone's push service
//   that the message comes from us.
// - Message encryption (RFC 8291 with RFC 8188 "aes128gcm"): only the phone
//   that subscribed can read the notification.

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** A new VAPID key pair: the public key in the raw 65-byte form browsers want, the private key as its 32-byte d. */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64u.encode(concat([4], b64u.decode(jwk.x), b64u.decode(jwk.y))), privateKey: jwk.d };
}

function vapidJwk(publicKey, privateKey) {
  const raw = b64u.decode(publicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('VAPID public key must be a raw uncompressed P-256 key');
  return { kty: 'EC', crv: 'P-256', x: b64u.encode(raw.slice(1, 33)), y: b64u.encode(raw.slice(33)), d: privateKey, ext: true };
}

/**
 * The Authorization header for one push request: "vapid t=<signed token>, k=<public key>".
 * The token is for the push service's origin and lasts 12 hours (services allow up to 24).
 */
export async function vapidAuthorization({ endpoint, subject, publicKey, privateKey, now = Date.now() }) {
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject };
  const body = b64u.encode(enc.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    'jwk',
    vapidJwk(publicKey, privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${body}`));
  return `vapid t=${header}.${body}.${b64u.encode(signature)}, k=${publicKey}`;
}

const RECORD_SIZE = 4096;

/**
 * Encrypts a notification for one subscription (its p256dh key and auth secret).
 * `salt` and `senderKeys` are only passed in by tests; normally they're fresh each time.
 */
export async function encryptPayload({ payload, p256dh, auth, salt, senderKeys }) {
  const plaintext = typeof payload === 'string' ? enc.encode(payload) : payload;
  if (plaintext.length + 17 > RECORD_SIZE - 86) throw new Error('Notification too large');

  const receiverPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const sender = senderKeys || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));

  const receiverKey = await crypto.subtle.importKey('raw', receiverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256));

  // RFC 8291 section 3.4: mix in the subscription's auth secret, then derive the content key and nonce.
  const prkKey = await hmac(authSecret, shared);
  const keyInfo = concat(enc.encode('WebPush: info\0'), receiverPublic, senderPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);

  // One record: the message, then the "last record" padding delimiter.
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, [2])));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, sealed);
}

/**
 * Sends one notification. Returns { ok, status, gone }: `gone` means the phone
 * unsubscribed or the subscription expired, so it should be forgotten.
 */
export async function sendPush(subscription, message, vapid, { fetch = globalThis.fetch, ttl = 24 * 3600 } = {}) {
  const body = await encryptPayload({ payload: JSON.stringify(message), p256dh: subscription.p256dh, auth: subscription.auth });
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization({ endpoint: subscription.endpoint, ...vapid }),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
