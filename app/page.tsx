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
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    color: "#F7F5FA",
  },
  card: {
    maxWidth: 560,
    width: "100%",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    padding: "32px 28px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  h1: { fontSize: 26, fontWeight: 700, margin: 0 },
  tagline: {
    color: "#849440",
    fontWeight: 500,
    margin: "0 0 8px 0",
    fontSize: 14,
  },
  p: { color: "rgba(247,245,250,0.55)", lineHeight: 1.55, margin: 0 },
  input: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(247,245,250,0.1)",
    borderRadius: 8,
    color: "#F7F5FA",
    fontSize: 14,
    padding: "10px 12px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    fontFamily: "monospace",
  },
  primaryBtn: {
    background: "#849440",
    color: "#F7F5FA",
    border: "none",
    borderRadius: 10,
    padding: "13px 24px",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
  },
  secondaryBtn: {
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#F7F5FA",
    cursor: "pointer",
    fontSize: 14,
    padding: "10px 16px",
    whiteSpace: "nowrap" as const,
  },
  urlBox: {
    padding: "14px 16px",
    background: "rgba(132,148,64,0.06)",
    border: "1px solid rgba(132,148,64,0.2)",
    borderRadius: 12,
  },
  urlLabel: {
    fontSize: 11,
    color: "rgba(247,245,250,0.4)",
    marginBottom: 8,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  code: {
    fontSize: 12,
    color: "#849440",
    flex: 1,
    wordBreak: "break-all" as const,
  },
  copyBtn: {
    background: "rgba(132,148,64,0.1)",
    border: "1px solid rgba(132,148,64,0.25)",
    borderRadius: 6,
    color: "#849440",
    cursor: "pointer",
    fontSize: 12,
    padding: "6px 12px",
    whiteSpace: "nowrap" as const,
  },
  tipBox: {
    fontSize: 12,
    color: "rgba(247,245,250,0.4)",
    lineHeight: 1.6,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: "12px 14px",
  },
  tipKey: { color: "#88739E", fontFamily: "monospace" },
  switchBtn: {
    background: "none",
    border: "none",
    color: "rgba(247,245,250,0.25)",
    cursor: "pointer",
    fontSize: 12,
    marginTop: 8,
  },
  divider: {
    color: "rgba(247,245,250,0.2)",
    fontSize: 12,
    textAlign: "center" as const,
    margin: "4px 0",
  },
  errorText: { color: "#ff9090", fontSize: 13 },
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
          <p style={s.tagline}>Vertexism knowledge graph MCP.</p>
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
              <span style={s.tipKey}>Settings → Integrations</span>, or paste
              it into your <span style={s.tipKey}>claude_desktop_config.json</span>{" "}
              as a <span style={s.tipKey}>{'"type": "url"'}</span> MCP server.
              Your token is your namespace — keep it private and don&rsquo;t lose it.
            </div>

            <button onClick={switchToken} style={s.switchBtn}>
              Use a different token
            </button>
          </>
        )}

        <p
          style={{
            color: "rgba(247,245,250,0.3)",
            fontSize: 12,
            margin: 0,
            paddingTop: 4,
          }}
        >
          Built by{" "}
          <a
            href="https://adhdesigns.dev"
            style={{ color: "#88739E", textDecoration: "none" }}
          >
            ADHDesigns
          </a>
          .
        </p>
      </div>
    </main>
  );
}
