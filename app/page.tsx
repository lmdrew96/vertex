"use client";

import { useEffect, useState } from "react";
import type { PublicAccount } from "@/lib/auth";
import { AuthPanel } from "./auth-panel";
import { Dashboard } from "./Dashboard";
import { ThemeToggle } from "./ThemeToggle";
import { postAuth, rememberToken, s, STORAGE_KEY } from "./accountUi";

type Account = PublicAccount | null | undefined; // undefined = still loading

// Signed out: sign in / sign up / claim. Signed in: the dashboard. Account controls live at /settings.
export default function Home() {
  const [account, setAccount] = useState<Account>(undefined);
  const [localToken, setLocalToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setLocalToken(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      // Storage blocked — the account is the source of truth anyway.
    }
    postAuth("me")
      .then((d) => setAccount(d.account ?? null))
      .catch(() => {
        setAccount(null);
        setError("Couldn't reach the server to check your sign-in.");
      });
  }, []);

  if (account) return <Dashboard token={account.token} />;

  return (
    <main style={s.page}>
      <ThemeToggle extraStyle={{ position: "absolute", top: 16, right: 16 }} />
      <div className="card" style={s.card}>
        <div>
          <h1 className="hero-title" style={s.h1}>Vertex</h1>
          <p style={s.tagline}>People graph MCP</p>
          <p style={s.p}>
            Your network as a graph. Nodes are people, groups, meetings, and topics. Edges are
            how they relate — who belongs where, who introduced whom, what came up when.
          </p>
        </div>

        {account === undefined ? (
          <p style={s.divider}>Loading…</p>
        ) : (
          <>
            {localToken && (
              <div style={s.tipBox}>
                This browser has a Vertex URL that isn&rsquo;t linked to an account yet. Create an
                account below to claim it. It&rsquo;s already filled in, and your Claude connector
                keeps working.
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <AuthPanel
              claimToken={localToken}
              onSignedIn={(a) => {
                setAccount(a);
                rememberToken(a.token);
                setLocalToken(a.token);
                setError("");
              }}
            />
          </>
        )}

        <p style={s.footer}>
          Built by{" "}
          <a href="https://adhdesigns.dev" style={{ textUnderlineOffset: 3 }}>
            ADHDesigns
          </a>
          .
        </p>
      </div>
    </main>
  );
}
