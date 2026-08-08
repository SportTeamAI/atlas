import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Sirve bajo /atlas en productodeportivas.com/atlas
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
