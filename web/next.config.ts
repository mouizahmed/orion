import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  async headers() {
    const callbackScriptSources = [
      "'self'",
      "'unsafe-inline'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ].join(" ");
    const callbackCsp = [
      "default-src 'self'",
      `script-src ${callbackScriptSources}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      isDevelopment ? "connect-src 'self' ws: wss:" : "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
    ].join("; ");
    const callbackHeaders = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Content-Security-Policy", value: callbackCsp },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/auth/callback", headers: callbackHeaders },
      { source: "/auth/error", headers: callbackHeaders },
      { source: "/auth/complete", headers: callbackHeaders },
      { source: "/integrations/callback", headers: callbackHeaders },
    ];
  },
  images: {
    remotePatterns: [
      ...["lh3", "lh4", "lh5", "lh6"].map((subdomain) => ({
        protocol: "https" as const,
        hostname: `${subdomain}.googleusercontent.com`,
        port: "",
        pathname: "/**",
      })),
      ...(process.env.NODE_ENV === "development"
        ? [{ protocol: "http" as const, hostname: "localhost", pathname: "/**" }]
        : []),
    ],
  },
};

export default nextConfig;
