import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // TCGplayer product images served via TCGAPIs catalog data
      { protocol: "https", hostname: "product-images.tcgplayer.com" },
      { protocol: "https", hostname: "tcgplayer-cdn.tcgplayer.com" },
    ],
  },
  serverExternalPackages: ["pg-boss", "pg"],
};

export default nextConfig;
