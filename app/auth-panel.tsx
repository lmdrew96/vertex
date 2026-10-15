"use client";

import { useState } from "react";
import type { PublicAccount } from "@/lib/auth";

const s = {
  wrap: { display: "flex", flexDirection: "column" as const, gap: 12 },
  tabs: { display: "flex", gap: 6 },
  tab: (on: boolean) => ({
    flex: 1,
    fontFamily: "var(--font-body)",
    background: on ? "var(--color-teal-deep)" : "transparent",
    border: `1.5px solid ${on ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    borderRadius: 9999,
    color: on ? "var(--color-white)" : "var(--color-ink)",
    fontSize: 13.5,
    fontWeight: 600,
    padding: "9px 12px",
    cursor: "pointer",
  }),
  input: (mono = false) => ({
    fontFamily: mono ? "var(--font-mono)" : "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 14,
    padding: "10px 12px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  }),
  label: {
    fontFamily: "var(--font-body)",
    fontSize: 12.5,
    color: "var(--color-teal-deep)",
    margin: "4px 0 -4px",
  },
  submit: (busy: boolean) => ({
    fontFamily: "var(--font-body)",
    background: "var(--color-gold)",
    opacity: busy ? 0.6 : 1,
    color: "var(--color-on-light)",
    border: "none",
    borderRadius: 9999,
    padding: "12px 20px",
    fontWeight: 600,
    fontSize: 15,
    cursor: busy ? "default" : "pointer",
    width: "100%",
  }),
  error: { fontFamily: "var(--font-body)", color: "var(--color-danger)", fontSize: 13, margin: 0 },
  hint: {
    fontFamily: "var(--font-body)",
    color: "var(--color-teal-deep)",
    opacity: 0.7,
    fontSize: 12.5,
    lineHeight: 1.55,
    margin: 0,
  },
};

type Mode = "signup" | "login";

export const AuthPanel = ({
  initialMode = "signup",
  claimToken = "",
  onSignedIn,
}: {
  initialMode?: Mode;
  claimToken?: string; // a token this browser already has — offered for claiming at signup
  onSignedIn: (account: PublicAccount) => void;
}) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [claim, setClaim] = useState(claimToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          email,
          password,
          ...(mode === "signup" && claim.trim() ? { claim } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      onSignedIn(data.account as PublicAccount);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
  };

  return (
    <div style={s.wrap}>
      <div style={s.tabs}>
        <button type="button" onClick={() => switchMode("signup")} style={s.tab(mode === "signup")}>
          Create account
        </button>
        <button type="button" onClick={() => switchMode("login")} style={s.tab(mode === "login")}>
          Sign in
        </button>
      </div>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="you@example.com"
        autoComplete="email"
        style={s.input()}
        aria-label="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={mode === "signup" ? "Password (10+ characters)" : "Password"}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        style={s.input()}
        aria-label="Password"
      />

      {mode === "signup" && (
        <>
          <p style={s.label}>Already have a Vertex URL? Paste it to keep that graph (optional)</p>
          <input
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="https://vertex.adhdesigns.dev/…/mcp or the token"
            style={s.input(true)}
            aria-label="Existing Vertex URL or token"
          />
        </>
      )}

      {error && <p style={s.error}>{error}</p>}

      <button type="button" onClick={submit} disabled={busy} style={s.submit(busy)}>
        {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>

      <p style={s.hint}>
        {mode === "signup" && claim.trim()
          ? "Your account takes over that URL, and anything already connected to it keeps working."
          : "Your account keeps your MCP URL safe, so you can always get it back."}
        {mode === "signup" && " There's no password reset yet, so use a password manager."}
      </p>
    </div>
  );
};
