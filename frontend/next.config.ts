import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // Monorepo sibling of backend/contracts: pin the workspace root so
    // Turbopack stops inferring it from stray lockfiles above us.
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
