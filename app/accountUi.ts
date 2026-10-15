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
    padding: "48px 16px",
  },
  card: {
    maxWidth: 560,
    width: "100%",
    padding: 24,
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: 40,
    fontWeight: 700,
    color: "var(--foreground)",
    margin: 0,
    lineHeight: 1.1,
  },
  tagline: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "1.4px",
    textTransform: "uppercase" as const,
    color: "var(--muted-foreground)",
    margin: "10px 0 0 0",
  },
  p: {
    fontFamily: "var(--font-body)",
    color: "var(--muted-foreground)",
    lineHeight: 1.6,
    margin: "10px 0 0 0",
    fontSize: 15,
  },
  divider: {
    fontFamily: "var(--font-body)",
    color: "var(--muted-foreground)",
    fontSize: 13,
    textAlign: "center" as const,
    margin: 0,
  },
  urlBox: {
    padding: "14px 16px",
    background: "var(--inset)",
    border: "1.5px solid var(--hairline)",
    borderRadius: "var(--radius)",
  },
  urlLabel: { margin: "0 0 8px 0" },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--foreground)",
    flex: 1,
    wordBreak: "break-all" as const,
  },
  tipBox: {
    fontFamily: "var(--font-body)",
    fontSize: 13.5,
    color: "var(--foreground)",
    lineHeight: 1.6,
    background: "var(--inset)",
    border: "1.5px solid var(--hairline)",
    borderRadius: "var(--radius)",
    padding: "14px 16px",
  },
  tipKey: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500 },
  footer: {
    fontFamily: "var(--font-body)",
    color: "var(--muted-foreground)",
    fontSize: 12.5,
    margin: 0,
  },
};
