import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export estático para Firebase Hosting
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
