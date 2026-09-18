import type { NextConfig } from "next";

// Next 16: Turbopack is the default for dev and build (never add a `webpack` key),
// `cacheComponents` stays off (dynamic-by-default suits a cookie-authenticated admin app),
// and the request interceptor lives in src/proxy.ts.
const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  typedRoutes: true,
  serverExternalPackages: ["@prisma/client", "pg", "pg-boss", "nodemailer"],
  images: { unoptimized: true },
};

export default nextConfig;
