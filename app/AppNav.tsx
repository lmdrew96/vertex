"use client";

import { ThemeToggle } from "./ThemeToggle";

export type NavPage = "dashboard" | "graph" | "settings";

/** Dashboard · Graph · Settings, plus the theme switch. `token` is the account's current URL token. */
export function AppNav({ token, current }: { token: string; current: NavPage }) {
  const links: Array<[NavPage, string, string]> = [
    ["dashboard", "Dashboard", "/"],
    ["graph", "Graph", `/${token}/graph`],
    ["settings", "Settings", "/settings"],
  ];
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} aria-label="Vertex">
      {links.map(([page, label, href]) => (
        <a
          key={page}
          href={href}
          className="chip"
          style={{ textDecoration: "none" }}
          aria-current={page === current ? "page" : undefined}
        >
          {label}
        </a>
      ))}
      <ThemeToggle extraStyle={{ marginLeft: 4 }} />
    </nav>
  );
}
