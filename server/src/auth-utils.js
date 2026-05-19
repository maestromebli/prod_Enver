import crypto from "crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  try {
    const candidate = crypto.scryptSync(password, salt, KEY_LEN).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(candidate, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
