"use client";

import { useEffect, useState } from "react";
import type { PublicAccount } from "@/lib/auth";
import { AppNav } from "../AppNav";
import { postAuth, rememberToken, s } from "../accountUi";

const BASE_URL = typeof window !== "undefined" ? window.location.origin : "https://vertex.adhdesigns.dev";

export default function SettingsPage() {
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    postAuth("me")
      .then((d) => {
        // Settings needs an account; signed-out visitors sign in on the home page.
        if (!d.account) window.location.replace("/");
        else setAccount(d.account);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't reach the server to check your sign-in."));
  }, []);

  const signOut = async () => {
    try {
      await postAuth("logout");
      window.location.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign out.");
    }
  };

  const rotate = async () => {
    try {
      const { account: next } = await postAuth("rotate");
      if (!next) throw new Error("Rotation didn't return the new URL. Reload to see it.");
      setAccount(next);
      rememberToken(next.token);
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
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[vertex] copy failed:", e);
      setError("Couldn't copy. Select the URL and copy it by hand.");
    }
  };

  return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={s.h1}>Settings</h1>
          {account && <AppNav token={token} current="settings" />}
        </div>

        {!account ? (
          error ? (
            <p style={s.errorText}>{error}</p>
          ) : (
            <p style={s.divider}>Loading…</p>
          )
        ) : (
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
        )}
      </div>
    </main>
  );
}
