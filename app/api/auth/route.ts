import {
  AuthError,
  clearRateLimit,
  clearedCookie,
  clientIp,
  createAccount,
  createSession,
  destroySession,
  getAccount,
  isRateLimited,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  publicAccount,
  readCookie,
  requireAccount,
  rotateToken,
  SESSION_COOKIE,
  sessionCookie,
  verifyPassword,
} from "@/lib/auth";

// PBKDF2 is deliberate CPU work — more than the edge runtime is meant to do.
// /{token}/mcp stays on edge.
export const runtime = "nodejs";

const json = (body: unknown, init?: ResponseInit): Response => Response.json(body, init);
const fail = (message: string, status = 400): Response =>
  Response.json({ error: message }, { status });

/** Never reveal whether an email exists — same message for both failure modes. */
const BAD_CREDENTIALS = "Email or password is incorrect.";

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Malformed request body.");
  }

  const action = String(body.action ?? "");
  const ip = clientIp(req);

  // ── me ─────────────────────────────────────────────────────────────────────
  if (action === "me") {
    const account = await requireAccount(req);
    return json({ account: account ? publicAccount(account) : null });
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  if (action === "logout") {
    await destroySession(readCookie(req, SESSION_COOKIE));
    return json({ ok: true }, { headers: { "Set-Cookie": clearedCookie() } });
  }

  // ── rotate ─────────────────────────────────────────────────────────────────
  if (action === "rotate") {
    const account = await requireAccount(req);
    if (!account) return fail("Not signed in.", 401);
    const next = await rotateToken(account);
    return json({ account: publicAccount(next) });
  }

  // ── signup / login ─────────────────────────────────────────────────────────
  if (action !== "signup" && action !== "login") return fail(`Unknown action: ${action}`);

  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");

  if (!isValidEmail(email)) return fail("That doesn't look like an email address.");

  if (await isRateLimited(`${action}:ip`, ip, action === "signup" ? 5 : 20, 900)) {
    return fail("Too many attempts. Wait 15 minutes and try again.", 429);
  }

  if (action === "signup") {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const claim = typeof body.claim === "string" && body.claim.trim() ? body.claim : undefined;
    try {
      const account = await createAccount(email, password, claim);
      const sid = await createSession(email);
      return json(
        { account: publicAccount(account), claimed: claim !== undefined },
        { headers: { "Set-Cookie": sessionCookie(sid) } },
      );
    } catch (e) {
      if (e instanceof AuthError) return fail(e.message, e.status);
      throw e;
    }
  }

  // login
  if (await isRateLimited("login:email", email, 8, 900)) {
    return fail("Too many attempts for this account. Wait 15 minutes and try again.", 429);
  }
  const account = await getAccount(email);
  if (!account) return fail(BAD_CREDENTIALS, 401);
  if (!(await verifyPassword(account, password))) return fail(BAD_CREDENTIALS, 401);

  await clearRateLimit("login:email", email);
  const sid = await createSession(email);
  return json(
    { account: publicAccount(account) },
    { headers: { "Set-Cookie": sessionCookie(sid) } },
  );
}
