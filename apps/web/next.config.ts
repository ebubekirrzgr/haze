import type { NextConfig } from "next";

// Tek origin: PWA, haze-api ve POS terminali ayni alan adi altinda durur.
// Compose icinde servis adlariyla, yerelde localhost ile calisir.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8787";
const TERMINAL_ORIGIN = process.env.TERMINAL_ORIGIN ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@haze/stellar"],
  experimental: { externalDir: true },
  headers: async () => [{ source: "/(.*)", headers: [{ key: "Service-Worker-Allowed", value: "/" }] }],
  rewrites: async () => [
    { source: "/api/:path*", destination: `${API_ORIGIN}/:path*` },
    { source: "/terminal", destination: `${TERMINAL_ORIGIN}/` },
    { source: "/terminal/:path*", destination: `${TERMINAL_ORIGIN}/:path*` },
  ],
};
export default nextConfig;
