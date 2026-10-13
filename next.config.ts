import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 开发徽标会盖在手机页面左下角，挡住模式切换
  devIndicators: false,
  // 手机通过局域网 IP 访问开发服务器时，放行热更新 WebSocket 等开发资源（IP 会变，所以放开整个网段）
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // 家目录里有别的 lockfile，显式指定本项目为根目录
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
