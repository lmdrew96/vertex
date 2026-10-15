import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray ~/package-lock.json made Turbopack pick the home directory as the workspace root,
  // and `next dev` hung on the edge routes. Pin it to this project.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
