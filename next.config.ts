import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/cephas-bomb-squad",
  assetPrefix: "/cephas-bomb-squad/",
  trailingSlash: true,
};

export default nextConfig;