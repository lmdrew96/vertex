import "./globals.css";
import "@xyflow/react/dist/style.css";

export const metadata = { title: "Vertex" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
