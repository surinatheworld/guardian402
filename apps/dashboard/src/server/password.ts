// Password hashing with Node's built-in scrypt (no native dependency). Stored format:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// so the cost can be raised later and old hashes still verify.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;
// N=2^15, r=8 needs 32 MiB; Node's default maxmem is exactly 32 MiB, so give it headroom.
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

function derive(password: string, salt: Buffer, opts: ScryptOptions, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: MAXMEM }, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(
    password,
    Buffer.from(salt, "base64"),
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
    expected.length,
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash work for unknown emails too, so response time does not reveal which emails exist. */
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("guardian402-dummy-password");
  await verifyPassword(password, await dummy);
}

/** null when acceptable, else a Vietnamese reason. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`;
  if (password.length > PASSWORD_MAX) return `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.`;
  return null;
}
