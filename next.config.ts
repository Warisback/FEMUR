import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The AI prompt files are read from disk at runtime — make sure they ship
  // with the serverless bundles on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./lib/ai/prompts/*.md"],
  },
  // Local dev on this machine junctions node_modules/.next outside the
  // OneDrive-synced repo (see NOTES.md). Turbopack then needs a resolution
  // root that contains both the repo and the junction targets. Unset in prod.
  ...(process.env.TURBOPACK_ROOT
    ? { turbopack: { root: process.env.TURBOPACK_ROOT } }
    : {}),
};

export default nextConfig;
