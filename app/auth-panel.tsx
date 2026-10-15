"use client";

import { useState } from "react";
import type { PublicAccount } from "@/lib/auth";

const s = {
  wrap: { display: "flex", flexDirection: "column" as const, gap: 12 },
  tabs: { display: "flex", gap: 8 },
  label: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted-foreground)", margin: "4px 0 -4px" },
  hint: { fontFamily: "var(--font-body)", color: "var(--muted-foreground)", fontSize: 13, lineHeight: 1.55, margin: 0 },
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
        <button
          type="button"
          onClick={() => switchMode("signup")}
          className="chip"
          style={{ flex: 1, justifyContent: "center", padding: "8px 10px" }}
          aria-pressed={mode === "signup"}
        >
          Create account
        </button>
        <button
          type="button"
          onClick={() => switchMode("login")}
          className="chip"
          style={{ flex: 1, justifyContent: "center", padding: "8px 10px" }}
          aria-pressed={mode === "login"}
        >
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
        className="input"
        aria-label="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={mode === "signup" ? "Password (10+ characters)" : "Password"}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        className="input"
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
            className="input"
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            aria-label="Existing Vertex URL or token"
          />
        </>
      )}

      {error && <p className="error-text">{error}</p>}

      <button type="button" onClick={submit} disabled={busy} className="btn btn-primary" style={{ width: "100%" }}>
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
