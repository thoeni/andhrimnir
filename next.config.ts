import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Helps Next.js output tracing find the correct root when multiple lockfiles exist
  outputFileTracingRoot: path.join(__dirname, "."),
};

export default nextConfig;

