/**
 * Account auth, ported from Tangle's lib/auth.ts (itself from personal-context-mcp).
 *
 * Differences from Tangle:
 * - Indirection: an account owns a `token` (what's in the MCP URL) and a `graphId`
 *   (the Redis namespace its nodes/edges live under). They start equal; rotating the
 *   token changes only `token`, so graph keys never move.
 * - A token rotated out of an account is marked retired and resolves to nothing (401),
 *   instead of falling through to an empty namespace that would read as data loss.
 * - Tokens never claimed by an account keep working as their own namespace, exactly as
 *   before accounts existed, so an already-connected Claude never breaks.
 * - 100k PBKDF2 iterations (stored per record), within Cloudflare Workers' Web Crypto cap.
 */

import { redis } from "./redis";
import { accountKey, rateKey, retiredTokenKey, sessionKey, tokenOwnerKey } from "./keys";

export const SESSION_COOKIE = "vertex_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Stored on the record so the cost can be raised later without breaking old hashes. */
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export const MIN_PASSWORD_LENGTH = 10;

export type Account = {
  email: string;
  passwordHash: string; // base64
  salt: string; // base64
  iterations: number;
  hash: string; // e.g. "SHA-256"
  token: string; // current MCP URL token
  graphId: string; // Redis namespace for this account's graph — never changes
  createdAt: string;
};

type TokenOwner = { email: string; graphId: string };

/** The shape safe to hand back to the browser — never the hash or salt. */
export type PublicAccount = Pick<Account, "email" | "token" | "createdAt">;

export const publicAccount = (a: Account): PublicAccount => ({
  email: a.email,
  token: a.token,
  createdAt: a.createdAt,
});

// ── Encoding helpers ─────────────────────────────────────────────────────────

const toB64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const fromB64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const randomB64Url = (bytes: number): string => {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return toB64(buf.buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Constant-time comparison — never short-circuit on the first differing byte. */
const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

// ── Password hashing (Web Crypto PBKDF2) ─────────────────────────────────────

const derive = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: string,
): Promise<ArrayBuffer> => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash },
    keyMaterial,
    KEY_BYTES * 8,
  );
};

export const hashPassword = async (
  password: string,
): Promise<Pick<Account, "passwordHash" | "salt" | "iterations" | "hash">> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await derive(password, salt, PBKDF2_ITERATIONS, PBKDF2_HASH);
  return {
    passwordHash: toB64(bits),
    salt: toB64(salt.buffer),
    iterations: PBKDF2_ITERATIONS,
    hash: PBKDF2_HASH,
  };
};

export const verifyPassword = async (account: Account, password: string): Promise<boolean> => {
  const bits = await derive(
    password,
    fromB64(account.salt),
    account.iterations ?? PBKDF2_ITERATIONS,
    account.hash ?? PBKDF2_HASH,
  );
  return timingSafeEqual(new Uint8Array(bits), fromB64(account.passwordHash));
};

// ── Email + token input ──────────────────────────────────────────────────────

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const UUID_ANYWHERE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const BARE_TOKEN = /^[A-Za-z0-9._~-]{8,128}$/;

/**
 * Accept a bare token or a full Vertex URL (from Tangle's token-input.ts). Takes the
 * last UUID in the string; otherwise a narrow bare-token shape, so a pasted URL can
 * never be stored verbatim as a token.
 */
export const parseVertexToken = (raw: string): string | null => {
  const input = raw.trim();
  if (!input) return null;
  const uuids = input.match(UUID_ANYWHERE);
  if (uuids?.length) return uuids[uuids.length - 1].toLowerCase();
  return BARE_TOKEN.test(input) ? input : null;
};

// ── Token → graph resolution (MCP route, graph page, server actions) ─────────

/**
 * The graph namespace a URL token may read and write, or null (→ 401). Owned → that
 * account's graphId. Malformed, retired, or never claimed → null: every graph needs an account.
 */
export const resolveGraphId = async (token: string): Promise<string | null> => {
  if (!BARE_TOKEN.test(token)) return null;
  const [owner, retired] = await Promise.all([
    redis.get<TokenOwner>(tokenOwnerKey(token)),
    redis.get(retiredTokenKey(token)),
  ]);
  if (owner && !retired) return owner.graphId;
  return null;
};

// ── Accounts ─────────────────────────────────────────────────────────────────

export const getAccount = async (email: string): Promise<Account | null> =>
  (await redis.get<Account>(accountKey(email))) ?? null;

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Create an account. With `claim`, the existing token becomes both the account's token
 * and its graph namespace, so the URL Claude is already connected to keeps working.
 */
export const createAccount = async (
  email: string,
  password: string,
  claim?: string,
): Promise<Account> => {
  if (await getAccount(email)) {
    throw new AuthError("An account with that email already exists. Sign in instead.", 409);
  }

  let token: string = crypto.randomUUID();
  if (claim !== undefined) {
    const parsed = parseVertexToken(claim);
    if (!parsed) {
      throw new AuthError(
        "That isn't a valid token or Vertex URL. Paste the token itself or the full MCP URL.",
        400,
      );
    }
    const [owner, retired] = await Promise.all([
      redis.get(tokenOwnerKey(parsed)),
      redis.get(retiredTokenKey(parsed)),
    ]);
    if (owner || retired) {
      throw new AuthError("That token already belongs to an account and can't be claimed.", 403);
    }
    token = parsed;
  }

  const account: Account = {
    email,
    ...(await hashPassword(password)),
    token,
    graphId: token,
    createdAt: new Date().toISOString(),
  };
  await redis.set(tokenOwnerKey(token), { email, graphId: token } satisfies TokenOwner);
  await redis.set(accountKey(email), account);
  return account;
};

/**
 * Swap the account's MCP token for a new one. The new token works before the old one
 * stops, and the graph stays where it is. The old token is retired (401 from then on).
 */
export const rotateToken = async (account: Account): Promise<Account> => {
  const previous = account.token;
  const next: Account = { ...account, token: crypto.randomUUID() };
  await redis.set(tokenOwnerKey(next.token), {
    email: next.email,
    graphId: next.graphId,
  } satisfies TokenOwner);
  await redis.set(accountKey(next.email), next);
  await Promise.all([
    redis.set(retiredTokenKey(previous), next.email),
    redis.del(tokenOwnerKey(previous)),
  ]);
  return next;
};

// ── Sessions (opaque random ids, revocable, no signing secret needed) ────────

export const createSession = async (email: string): Promise<string> => {
  const sid = randomB64Url(32);
  await redis.set(sessionKey(sid), email, { ex: SESSION_TTL_SECONDS });
  return sid;
};

export const readSession = async (sid: string | undefined): Promise<string | null> => {
  if (!sid) return null;
  return (await redis.get<string>(sessionKey(sid))) ?? null;
};

export const destroySession = async (sid: string | undefined): Promise<void> => {
  if (sid) await redis.del(sessionKey(sid));
};

export const sessionCookie = (sid: string): string =>
  `${SESSION_COOKIE}=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;

export const clearedCookie = (): string =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
};

/** Resolve the signed-in account from the request cookie, or null. */
export const requireAccount = async (req: Request): Promise<Account | null> => {
  const email = await readSession(readCookie(req, SESSION_COOKIE));
  if (!email) return null;
  return getAccount(email);
};

// ── Rate limiting ────────────────────────────────────────────────────────────

/** Hash the identifier so raw IP addresses never become Redis key names. */
const rateId = async (id: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return toB64(digest).replace(/[+/=]/g, "").slice(0, 22);
};

/** Returns true when the caller is over budget. Fails OPEN if Redis errors. */
export const isRateLimited = async (
  scope: string,
  id: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> => {
  try {
    const k = rateKey(scope, await rateId(id));
    const n = await redis.incr(k);
    if (n === 1) {
      await redis.expire(k, windowSeconds);
    } else if ((await redis.ttl(k)) < 0) {
      // INCR created the key but EXPIRE never landed; without this the caller is locked out forever.
      await redis.expire(k, windowSeconds);
    }
    return n > max;
  } catch (e) {
    console.error("[vertex] rate limit check failed, allowing request:", e instanceof Error ? e.message : e);
    return false;
  }
};

export const clearRateLimit = async (scope: string, id: string): Promise<void> => {
  await redis.del(rateKey(scope, await rateId(id)));
};

export const clientIp = (req: Request): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
