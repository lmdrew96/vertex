"use client";

import { ThemeToggle } from "./ThemeToggle";

export type NavPage = "dashboard" | "graph" | "settings";

const s = {
  nav: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" as const },
  link: (active: boolean) => ({
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--color-ink)" : "var(--color-teal-deep)",
    textDecoration: "none",
    padding: "4px 8px",
    borderRadius: 9999,
    background: active ? "var(--color-surface)" : "transparent",
    border: `1.5px solid ${active ? "var(--color-lavender)" : "transparent"}`,
  }),
};

/** Dashboard · Graph · Settings, plus the theme switch. `token` is the account's current URL token. */
export function AppNav({ token, current }: { token: string; current: NavPage }) {
  const links: Array<[NavPage, string, string]> = [
    ["dashboard", "Dashboard", "/"],
    ["graph", "Graph", `/${token}/graph`],
    ["settings", "Settings", "/settings"],
  ];
  return (
    <nav style={s.nav} aria-label="Vertex">
      {links.map(([page, label, href]) => (
        <a key={page} href={href} style={s.link(page === current)} aria-current={page === current ? "page" : undefined}>
          {label}
        </a>
      ))}
      <ThemeToggle extraStyle={{ marginLeft: 6 }} />
    </nav>
  );
}
