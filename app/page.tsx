"use client";

import { useEffect, useState } from "react";

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
    color: "var(--color-ink)",
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
    color: "var(--color-ink)",
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
    color: "#c0392b",
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

export default function Home() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setToken(saved);
  }, []);

  const generate = () => {
    const t = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, t);
    setToken(t);
    setError("");
  };

  const loadExisting = () => {
    const t = tokenInput.trim();
    if (!t) {
      setError("Paste a token first.");
      return;
    }
    localStorage.setItem(STORAGE_KEY, t);
    setToken(t);
    setError("");
  };

  const switchToken = () => {
    localStorage.removeItem(STORAGE_KEY);
    setToken("");
    setTokenInput("");
  };

  const mcpUrl = token ? `${BASE_URL}/${token}/mcp` : "";

  const copy = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main style={s.page}>
      <div style={s.card}>
        <div>
          <h1 style={s.h1}>Vertex</h1>
          <p style={s.tagline}>Vertexism knowledge graph MCP</p>
          <p style={s.p}>
            A graph-structured idea database. Nodes are things — concepts, people, works,
            claims, questions. Edges are how they relate. Meaning lives in the connections.
          </p>
        </div>

        {!token ? (
          <>
            <button onClick={generate} style={s.primaryBtn}>
              Generate my Vertex URL →
            </button>
            <p style={s.divider}>or</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadExisting()}
                placeholder="Paste an existing token"
                style={s.input}
              />
              <button onClick={loadExisting} style={s.secondaryBtn}>
                Load
              </button>
            </div>
            {error && <p style={s.errorText}>{error}</p>}
          </>
        ) : (
          <>
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
              Add this URL to Claude Desktop under{" "}
              <span style={s.tipKey}>Settings → Integrations</span>, or paste it into your{" "}
              <span style={s.tipKey}>claude_desktop_config.json</span> as a{" "}
              <span style={s.tipKey}>{'"type": "url"'}</span> MCP server.
              Your token is your namespace — keep it private and don&rsquo;t lose it.
            </div>

            <button onClick={switchToken} style={s.switchBtn}>
              Use a different token
            </button>
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
