import path from "path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Load the repo-root .env so the dashboard shares one source of truth with the bot
// (Next.js only auto-loads .env from the dashboard/ folder by default).
config({ path: path.resolve(process.cwd(), "../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
