import { afterEach, describe, expect, it } from 'vitest';
import { newId } from '@/lib/utils';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('newId', () => {
  const original = crypto.randomUUID;

  afterEach(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: original,
    });
  });

  it('returns a UUID', () => {
    expect(newId()).toMatch(UUID);
  });

  it('still works when randomUUID is missing (plain HTTP on a LAN IP)', () => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(typeof crypto.randomUUID).not.toBe('function');
    expect(newId()).toMatch(UUID);
    expect(new Set(Array.from({ length: 20 }, () => newId())).size).toBe(20);
  });
});
