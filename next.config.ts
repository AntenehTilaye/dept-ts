import type { NextConfig } from "next";

// Next 16: Turbopack is the default for dev and build (never add a `webpack` key),
// `cacheComponents` stays off (dynamic-by-default suits a cookie-authenticated admin app),
// and the request interceptor lives in src/proxy.ts.
const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  typedRoutes: true,
  serverExternalPackages: ["@prisma/client", "pg", "pg-boss", "nodemailer"],
  images: { unoptimized: true },
  // the dev server is also reached as http://web:3000 from other compose containers
  allowedDevOrigins: ["web", "localhost", "127.0.0.1"],
  // The built-in features keep their readable URLs, but there is only one implementation of
  // every page: /d/<dept>/tasks is the generic runtime of the `task` feature. The id in these
  // URLs is the FeatureRecord's, which is what SubjectRegistry.url hands out.
  async rewrites() {
    return [
      { source: "/d/:dept/tasks", destination: "/d/:dept/f/task" },
      { source: "/d/:dept/tasks/:path*", destination: "/d/:dept/f/task/:path*" },
      { source: "/d/:dept/cases", destination: "/d/:dept/f/case" },
      { source: "/d/:dept/cases/:path*", destination: "/d/:dept/f/case/:path*" },
    ];
  },
};

export default nextConfig;
