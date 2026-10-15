import type { PublicAccount } from "@/lib/auth";

// Shared by the signed-out home page and /settings: the account card's styles and auth calls.

export const STORAGE_KEY = "vertex:token";

export const postAuth = async (action: string): Promise<{ account?: PublicAccount | null; error?: string }> => {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
};

// The browser remembers its token so a signed-out visit can offer to claim it.
export const rememberToken = (token: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Non-essential convenience; ignore.
  }
};

export const s = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    background: "var(--color-surface)",
  },
  card: {
    maxWidth: 560,
    width: "100%",
    background: "var(--color-white)",
    borderRadius: 24,
    padding: "36px 32px",
    boxShadow: "0px 1px 1.5px rgba(0,0,0,0.10), 0px 1px 1px rgba(0,0,0,0.10)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontVariationSettings: "'SOFT' 0, 'WONK' 1",
    fontSize: 36,
    fontWeight: 600,
    color: "var(--color-ink)",
    margin: 0,
    lineHeight: 1.1,
  },
  tagline: {
    fontFamily: "var(--font-body)",
    color: "var(--color-teal-deep)",
    fontWeight: 500,
    margin: "4px 0 0 0",
    fontSize: 14,
  },
  p: {
    fontFamily: "var(--font-body)",
    color: "var(--color-teal-deep)",
    lineHeight: 1.55,
    margin: "8px 0 0 0",
    fontSize: 15,
    opacity: 0.8,
  },
  input: {
    fontFamily: "var(--font-mono)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 14,
    padding: "10px 12px",
    outline: "none",
    width: "100%",
  },
  primaryBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-gold)",
    color: "var(--color-on-light)",
    border: "none",
    borderRadius: 9999,
    padding: "13px 28px",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
    transition: "opacity 0.15s ease",
  },
  secondaryBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 9999,
    color: "var(--color-ink)",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    padding: "10px 18px",
    whiteSpace: "nowrap" as const,
  },
  divider: {
    color: "var(--color-teal-deep)",
    fontSize: 12,
    textAlign: "center" as const,
    margin: "0",
    opacity: 0.4,
  },
  urlBox: {
    padding: "16px 18px",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 16,
  },
  urlLabel: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-teal-deep)",
    marginBottom: 8,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    opacity: 0.6,
  },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--color-teal-deep)",
    flex: 1,
    wordBreak: "break-all" as const,
  },
  copyBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-mint)",
    border: "none",
    borderRadius: 9999,
    color: "var(--color-on-light)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 14px",
    whiteSpace: "nowrap" as const,
  },
  tipBox: {
    fontFamily: "var(--font-body)",
    fontSize: 13,
    color: "var(--color-teal-deep)",
    lineHeight: 1.6,
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 12,
    padding: "14px 16px",
  },
  tipKey: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--color-purple)",
  },
  switchBtn: {
    fontFamily: "var(--font-body)",
    background: "none",
    border: "none",
    color: "var(--color-teal-deep)",
    cursor: "pointer",
    fontSize: 12,
    opacity: 0.4,
    padding: 0,
  },
  errorText: {
    fontFamily: "var(--font-body)",
    color: "var(--color-danger)",
    fontSize: 13,
    margin: 0,
  },
  footer: {
    fontFamily: "var(--font-body)",
    color: "var(--color-teal-deep)",
    fontSize: 12,
    margin: 0,
    paddingTop: 4,
    opacity: 0.4,
  },
};
