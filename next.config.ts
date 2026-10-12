import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 家目录里有别的 lockfile，显式指定本项目为根目录
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
