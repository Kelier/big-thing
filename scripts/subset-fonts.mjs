// 收集源码里用到的字符 → 下载完整字体到临时目录 → 用 fonttools 裁剪成小 woff2 放进 public/fonts。
// 新增文案后重新运行：npm run fonts
// 依赖：python3 -m venv /tmp/fonttools-venv && /tmp/fonttools-venv/bin/pip install fonttools brotli
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PYFTSUBSET = process.env.PYFTSUBSET ?? "/tmp/fonttools-venv/bin/pyftsubset";
const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });

const collect = (dirs) => {
  const chars = new Set();
  for (const d of dirs) for (const f of walk(d)) for (const ch of readFileSync(f, "utf8")) if (ch.charCodeAt(0) > 31) chars.add(ch);
  for (let i = 32; i < 127; i++) chars.add(String.fromCharCode(i));
  return [...chars].join("");
};
const tmp = mkdtempSync(join(tmpdir(), "wte-fonts-"));
mkdirSync("public/fonts", { recursive: true });

// 故意不带现代浏览器 UA：Google 返回单个完整 TTF，而不是 100 多个 unicode-range 分片。
const jobs = [
  // 衬线：整个 src；手写体：只用于副标题 / 俏皮话 / 绳子旁批注，缩小体积
  ["serif", "Noto+Serif+SC:wght@900", ["src"]],
  ["hand", "Long+Cang", ["src/data", "src/components/pull-cord"]],
];
for (const [name, family, dirs] of jobs) {
  const textFile = join(tmp, `${name}.txt`);
  const text = collect(dirs);
  writeFileSync(textFile, text);
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}&display=swap`)).text();
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
  if (urls.length !== 1) throw new Error(`${name}: expected 1 font file, got ${urls.length}`);
  const full = join(tmp, `${name}.ttf`);
  writeFileSync(full, Buffer.from(await (await fetch(urls[0])).arrayBuffer()));
  const out = `public/fonts/${name}.woff2`;
  execFileSync(PYFTSUBSET, [full, `--text-file=${textFile}`, "--flavor=woff2", `--output-file=${out}`, "--layout-features=*"]);
  console.log(`${name}.woff2  ${[...text].length} chars  ${(statSync(out).size / 1024).toFixed(1)} KB`);
}
