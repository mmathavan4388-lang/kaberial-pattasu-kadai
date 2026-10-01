// RFC 6238 TOTP (SHA-1, 6 digits, 30s) for optional admin 2FA.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decode(s) {
  let bits = '';
  for (const c of s) bits += ALPHABET.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function code(secret, t = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export function verify(secret, token, t = Date.now()) {
  if (!/^\d{6}$/.test(String(token))) return false;
  return [-1, 0, 1].some((w) => {
    const a = Buffer.from(code(secret, t + w * 30000));
    const b = Buffer.from(String(token));
    return crypto.timingSafeEqual(a, b);
  });
}

export const otpauthUrl = (secret, email) =>
  `otpauth://totp/MAVRIX%20FIRE:${encodeURIComponent(email)}?secret=${secret}&issuer=MAVRIX%20FIRE`;
