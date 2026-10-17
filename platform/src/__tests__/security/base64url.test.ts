import { base64UrlFromBytes, bytesFromBase64Url } from '@/lib/base64url';

describe('base64url', () => {
  it('encodes bytes that map to + and / using - and _', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]); // std base64 "+/+/"
    expect(base64UrlFromBytes(bytes)).toBe('-_-_');
    expect(Array.from(bytesFromBase64Url('-_-_'))).toEqual(Array.from(bytes));
  });

  it('strips padding and restores it on decode', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 31]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 251) & 0xff);
      const enc = base64UrlFromBytes(bytes);
      expect(enc).not.toMatch(/[+/=]/);
      expect(Array.from(bytesFromBase64Url(enc))).toEqual(Array.from(bytes));
    }
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(bytesFromBase64Url(base64UrlFromBytes(all)))).toEqual(Array.from(all));
  });
});
