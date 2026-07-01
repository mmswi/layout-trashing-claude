import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kept on deliberately: the rAF loop must survive Strict Mode's dev
  // double-mount without leaking a second loop. See components/Lab.tsx.
  reactStrictMode: true,
};

export default nextConfig;
