import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@haze/stellar"],
  experimental: { externalDir: true },
  headers: async () => [{ source: "/(.*)", headers: [{ key: "Service-Worker-Allowed", value: "/" }] }],
};
export default nextConfig;
