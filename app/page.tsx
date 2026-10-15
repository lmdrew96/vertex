"use client";

import { useEffect, useState } from "react";
import type { PublicAccount } from "@/lib/auth";
import { AuthPanel } from "./auth-panel";
import { ThemeToggle } from "./ThemeToggle";

const BASE_URL =
  typeof window !== "undefined" ? window.location.origin : "https://vertex.adhdesigns.dev";
const STORAGE_KEY = "vertex:token";

const s = {
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

type Account = PublicAccount | null | undefined; // undefined = still loading

export default function Home() {
  const [account, setAccount] = useState<Account>(undefined);
  const [localToken, setLocalToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setLocalToken(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      // Storage blocked — the account is the source of truth anyway.
    }
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "me" }),
    })
      .then((r) => r.json())
      .then((d) => setAccount(d.account ?? null))
      .catch(() => {
        setAccount(null);
        setError("Couldn't reach the server to check your sign-in.");
      });
  }, []);

  const remember = (token: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      // Non-essential convenience; ignore.
    }
    setLocalToken(token);
  };

  const post = async (action: string) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  };

  const signOut = async () => {
    try {
      await post("logout");
      setAccount(null);
      setRotated(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign out.");
    }
  };

  const rotate = async () => {
    try {
      const data = await post("rotate");
      setAccount(data.account);
      remember(data.account.token);
      setConfirmRotate(false);
      setRotated(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rotate the token.");
    }
  };

  const token = account?.token ?? "";
  const mcpUrl = token ? `${BASE_URL}/${token}/mcp` : "";

  const copy = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main style={s.page}>
      <ThemeToggle extraStyle={{ position: "absolute", top: 16, right: 16 }} />
      <div style={s.card}>
        <div>
          <h1 style={s.h1}>Vertex</h1>
          <p style={s.tagline}>People graph MCP</p>
          <p style={s.p}>
            Your network as a graph. Nodes are people, groups, meetings, and topics. Edges are
            how they relate — who belongs where, who introduced whom, what came up when.
          </p>
        </div>

        {account === undefined ? (
          <p style={s.divider}>Loading…</p>
        ) : account ? (
          <>
            {rotated && (
              <div style={{ ...s.tipBox, borderColor: "var(--color-gold)" }}>
                <strong>New URL below — update your Claude connector.</strong> The old URL stopped
                working. In Claude, open <span style={s.tipKey}>Settings → Connectors → Vertex</span>{" "}
                and replace the URL with this one.
              </div>
            )}

            <div style={s.urlBox}>
              <p style={s.urlLabel}>Your MCP URL</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={s.code}>{mcpUrl}</code>
                <button onClick={copy} style={s.copyBtn}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>

            <a
              href={`/${token}/graph`}
              style={{ ...s.primaryBtn, display: "block", textAlign: "center", textDecoration: "none" }}
            >
              Open my graph →
            </a>

            <div style={s.tipBox}>
              Add this URL to Claude under <span style={s.tipKey}>Settings → Connectors</span>.
              Anyone with the URL can read and edit your graph, so keep it private. If it leaks,
              rotate it.
            </div>

            {confirmRotate ? (
              <div style={s.tipBox}>
                Rotating gives you a new URL and turns off the current one. Every Claude connected
                to Vertex will need the new URL.{" "}
                <span style={{ display: "inline-flex", gap: 8, marginTop: 8 }}>
                  <button onClick={rotate} style={s.copyBtn}>
                    Rotate now
                  </button>
                  <button onClick={() => setConfirmRotate(false)} style={s.switchBtn}>
                    Cancel
                  </button>
                </span>
              </div>
            ) : (
              <button onClick={() => setConfirmRotate(true)} style={s.switchBtn}>
                Rotate my URL
              </button>
            )}

            {error && <p style={s.errorText}>{error}</p>}

            <p style={s.divider}>
              Signed in as {account.email} ·{" "}
              <button onClick={signOut} style={{ ...s.switchBtn, opacity: 1 }}>
                Sign out
              </button>
            </p>
          </>
        ) : (
          <>
            {localToken && (
              <div style={s.tipBox}>
                This browser has a Vertex URL that isn&rsquo;t linked to an account yet. Create an
                account below to claim it. It&rsquo;s already filled in, and your Claude connector
                keeps working.
              </div>
            )}
            {error && <p style={s.errorText}>{error}</p>}
            <AuthPanel
              claimToken={localToken}
              onSignedIn={(a) => {
                setAccount(a);
                remember(a.token);
                setError("");
              }}
            />
          </>
        )}

        <p style={s.footer}>
          Built by{" "}
          <a href="https://adhdesigns.dev" style={{ color: "var(--color-purple)", textDecoration: "none" }}>
            ADHDesigns
          </a>
          .
        </p>
      </div>
    </main>
  );
}
