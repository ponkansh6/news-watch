import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client"],
  experimental: {
    optimizePackageImports: ["@google/generative-ai", "lucide-react"],
    // The build environment's child-process stdout pipe drops the tsc CLI output.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
