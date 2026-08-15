import crypto from "node:crypto";

// Minimal RFC 6238 TOTP implementation using only Node's built-in crypto —
// deliberately avoids adding a new npm dependency (package.json changes add
// deploy risk, as we've learned the hard way with node_modules/.gitignore).
function base32Decode(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32.replace(/=+$/, "").toUpperCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Dhan's TOTP secret is the same kind of base32 string you'd scan into
// Google Authenticator — this computes the same rolling 6-digit code an
// authenticator app would show, server-side, at request time.
export function generateTotpCode(secretBase32: string, stepSeconds = 30, digits = 6): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}
