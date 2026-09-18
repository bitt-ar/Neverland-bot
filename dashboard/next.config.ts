import path from "path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Load the repo-root .env so the dashboard shares one source of truth with the bot
// (Next.js only auto-loads .env from the dashboard/ folder by default).
config({ path: path.resolve(process.cwd(), "../.env") });

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
