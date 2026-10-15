import "./globals.css";
import "@xyflow/react/dist/style.css";
import { THEME_INIT_SCRIPT } from "./ThemeToggle";

export const metadata = { title: "Vertex" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark by default; the script flips to light before paint if that's the saved choice.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
