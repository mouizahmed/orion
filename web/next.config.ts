import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const callbackHeaders = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/auth/callback", headers: callbackHeaders },
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
