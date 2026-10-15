"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const STORAGE_KEY = "vertex-theme";
const EVENT = "vertex-theme-change";

const readTheme = (): Theme =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";

/** The current theme, kept in sync across every component that asks. Dark until mounted. */
export const useTheme = (): Theme => {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(readTheme());
    const sync = () => setTheme(readTheme());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return theme;
};

const setThemeEverywhere = (next: Theme): void => {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (e) {
    // Private mode or blocked storage: the switch still works for this visit.
    console.warn("[vertex] couldn't save the theme choice:", e);
  }
  window.dispatchEvent(new Event(EVENT));
};

/** Runs before first paint (inlined in layout.tsx) so a light-theme visitor never sees a dark flash. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${STORAGE_KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export function ThemeToggle({ extraStyle }: { extraStyle?: React.CSSProperties }) {
  const theme = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      style={extraStyle}
      onClick={() => setThemeEverywhere(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
