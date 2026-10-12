// MapLibre 的 worker 经 Turbopack 打包后无法加载，改为从 public 直接提供原始文件。
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/vendor", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/vendor/maplibre-gl-worker.mjs");
console.log("copied maplibre worker → public/vendor/");
