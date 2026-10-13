/**
 * 皮肤：一套皮肤 = 页面配色（globals.css 里的 [data-skin]）+ 绳子/手柄造型（引擎）+ 地图底色 + 站点图标。
 * 皮肤跟着模式走：吃=煎蛋、喝=矿泉水、拉=便便、睡=枕头、地图=指南针。
 * 颜色一律写成 "r,g,b" 字符串，方便拼 rgba()。
 */

import type { AppMode } from "@/data/cuisine-categories";

export type SkinId = "egg" | "water" | "poop" | "pillow" | "compass";
export type RopeKind = "hemp" | "thread" | "braid" | "water" | "chain";
export type HandleKind = "fried" | "bottle" | "poop" | "pillow" | "compass";

export type Skin = {
  id: SkinId;
  name: string;
  blurb: string;
  /** 浏览器地址栏颜色 */
  themeColor: string;
  /** 站点图标（SVG 源码），切换皮肤时同步替换 */
  icon: string;
  /** 切换面板里的小色块：纸 / 强调色 / 绳 a / 绳 b */
  swatch: [string, string, string, string];
  cord: {
    ink: string;
    /** 达到阈值时的荧光笔颜色 */
    hl: string;
    rope: { kind: RopeKind; a: string; b: string };
    /** c1 底色 · c2 暗部 · c3 亮部/条纹 · c4 点缀（蛋黄、水、眼白、纽扣） */
    handle: { kind: HandleKind; c1: string; c2: string; c3: string; c4: string };
  };
  map: {
    paper: string;
    land: string;
    park: string;
    water: string;
    building: string;
    road: string;
    casing: string;
    waterLine: string;
    ink: string;
  };
};

const svg = (bg: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/>${body}</svg>`;

export const SKINS: Record<SkinId, Skin> = {
  egg: {
    id: "egg",
    name: "煎蛋",
    blurb: "蛋奶黄纸、橙黄麻花绳，吊一颗煎蛋",
    themeColor: "#FFF3C4",
    icon: svg(
      "#FFF0B8",
      `<path d="M10 31c-2-11 8-19 19-17 8-4 21 0 23 11 6 4 5 15-3 19-4 8-17 10-24 6-9 3-17-6-15-19z" fill="#fff" stroke="#4A2C14" stroke-width="2.6" stroke-linejoin="round"/><circle cx="31" cy="34" r="10" fill="#F7A325" stroke="#4A2C14" stroke-width="2.2"/><ellipse cx="27.5" cy="30.5" rx="3" ry="2" fill="#fff" opacity=".85" transform="rotate(-30 27.5 30.5)"/>`,
    ),
    swatch: ["#fff3c4", "#ee7b14", "#ffaa28", "#ffffff"],
    cord: {
      ink: "74,44,20",
      hl: "255,130,40",
      rope: { kind: "braid", a: "255,170,40", b: "255,218,100" },
      handle: { kind: "fried", c1: "255,253,244", c2: "233,186,104", c3: "255,255,255", c4: "247,163,37" },
    },
    map: {
      paper: "#FFF1B8",
      land: "#FBE08E",
      park: "#D8E58E",
      water: "#BFE0D8",
      building: "#F7CE74",
      road: "#FFFBE6",
      casing: "#D9A441",
      waterLine: "#A9D3C8",
      ink: "#4A2C14",
    },
  },
  water: {
    id: "water",
    name: "矿泉水",
    blurb: "冰蓝纸面、水珠气泡绳，吊一瓶矿泉水",
    themeColor: "#E4F3FB",
    icon: svg(
      "#E4F3FB",
      `<rect x="25" y="6" width="14" height="8" rx="2" fill="#1F8FE0" stroke="#0F3550" stroke-width="2.2"/><path d="M28 14h8v5c0 3 10 5 10 13v21a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V32c0-8 10-10 10-13z" fill="#CDEAFA" stroke="#0F3550" stroke-width="2.6" stroke-linejoin="round"/><rect x="18" y="34" width="28" height="12" fill="#fff" stroke="#0F3550" stroke-width="2"/><path d="M20 40c3-3 5 3 8 0s5 3 8 0 5 3 8 0" fill="none" stroke="#1F8FE0" stroke-width="2" stroke-linecap="round"/>`,
    ),
    swatch: ["#e4f3fb", "#1f8fe0", "#96d2f5", "#ffffff"],
    cord: {
      ink: "15,53,80",
      hl: "90,200,255",
      rope: { kind: "water", a: "150,210,245", b: "255,255,255" },
      handle: { kind: "bottle", c1: "205,234,250", c2: "31,143,224", c3: "255,255,255", c4: "110,190,240" },
    },
    map: {
      paper: "#E4F3FB",
      land: "#D9ECF7",
      park: "#BFE3CF",
      water: "#9CD3F0",
      building: "#EAF4FA",
      road: "#FFFFFF",
      casing: "#9CC4DB",
      waterLine: "#7FBFE6",
      ink: "#0F3550",
    },
  },
  poop: {
    id: "poop",
    name: "便便",
    blurb: "奶茶褐纸面、棕麻绳，吊一坨笑脸便便",
    themeColor: "#F3E2C3",
    icon: svg(
      "#F3E2C3",
      `<path d="M32 7c5 3 4 8 0 10 9 1 13 6 11 11 7 2 10 9 5 15-3 6-13 9-16 9s-13-3-16-9c-5-6-2-13 5-15-2-5 2-10 11-11-4-2-5-7 0-10z" fill="#945E32" stroke="#3A2314" stroke-width="2.6" stroke-linejoin="round"/><circle cx="25.5" cy="42" r="4" fill="#fff" stroke="#3A2314" stroke-width="1.6"/><circle cx="38.5" cy="42" r="4" fill="#fff" stroke="#3A2314" stroke-width="1.6"/><circle cx="26.3" cy="42.6" r="1.7" fill="#3A2314"/><circle cx="37.7" cy="42.6" r="1.7" fill="#3A2314"/><path d="M26 49c3 4 9 4 12 0" fill="none" stroke="#3A2314" stroke-width="2" stroke-linecap="round"/>`,
    ),
    swatch: ["#f3e2c3", "#b9531c", "#ce9e62", "#945e32"],
    cord: {
      ink: "58,35,20",
      hl: "255,200,60",
      rope: { kind: "hemp", a: "206,158,98", b: "122,80,42" },
      handle: { kind: "poop", c1: "148,94,50", c2: "96,58,28", c3: "196,146,88", c4: "255,255,255" },
    },
    map: {
      paper: "#F3E2C3",
      land: "#EBD3A8",
      park: "#CFDB9A",
      water: "#BFD7D2",
      building: "#E3C690",
      road: "#FFF4DA",
      casing: "#B88E58",
      waterLine: "#A9C7C1",
      ink: "#3A2314",
    },
  },
  pillow: {
    id: "pillow",
    name: "枕头",
    blurb: "薰衣草纸面、粉紫棉线，吊一只软枕",
    themeColor: "#EFE9FB",
    icon: svg(
      "#EFE9FB",
      `<path d="M9 20c11-5 35-5 46 0 4 8 4 16 0 24-11 5-35 5-46 0-4-8-4-16 0-24z" fill="#FFF8FC" stroke="#3B3358" stroke-width="2.6" stroke-linejoin="round"/><path d="M15 25c9-3 25-3 34 0 3 6 3 8 0 14-9 3-25 3-34 0-3-6-3-8 0-14z" fill="none" stroke="#D6C4EC" stroke-width="2" stroke-dasharray="3 3"/><circle cx="32" cy="32" r="3.2" fill="#7C6AD6"/>`,
    ),
    swatch: ["#efe9fb", "#7c6ad6", "#ffa0be", "#f5f0ff"],
    cord: {
      ink: "59,51,88",
      hl: "255,170,210",
      rope: { kind: "thread", a: "255,160,190", b: "245,240,255" },
      handle: { kind: "pillow", c1: "255,248,252", c2: "214,196,236", c3: "255,255,255", c4: "124,106,214" },
    },
    map: {
      paper: "#EFE9FB",
      land: "#E6DEF6",
      park: "#CFE6D2",
      water: "#BFD6F0",
      building: "#F5EEFA",
      road: "#FFFFFF",
      casing: "#BDB0DD",
      waterLine: "#A9C4E6",
      ink: "#3B3358",
    },
  },
  compass: {
    id: "compass",
    name: "指南针",
    blurb: "海图黄纸、黄铜链，吊一枚指南针",
    themeColor: "#ECE4CF",
    icon: svg(
      "#ECE4CF",
      `<circle cx="32" cy="33" r="22" fill="#FAF4E0" stroke="#A8802F" stroke-width="5"/><circle cx="32" cy="33" r="22" fill="none" stroke="#23394A" stroke-width="1.6"/><path d="M32 15l5 18-5 3-5-3z" fill="#C84030" stroke="#23394A" stroke-width="1.6" stroke-linejoin="round"/><path d="M32 51l-5-18 5-3 5 3z" fill="#fff" stroke="#23394A" stroke-width="1.6" stroke-linejoin="round"/><circle cx="32" cy="33" r="2.6" fill="#A8802F" stroke="#23394A" stroke-width="1.2"/><rect x="28" y="4" width="8" height="6" rx="2" fill="#A8802F" stroke="#23394A" stroke-width="1.6"/>`,
    ),
    swatch: ["#ece4cf", "#c8553d", "#c9a04a", "#23394a"],
    cord: {
      ink: "35,57,74",
      hl: "255,180,60",
      rope: { kind: "chain", a: "201,160,74", b: "140,104,40" },
      handle: { kind: "compass", c1: "250,244,224", c2: "168,128,50", c3: "255,255,255", c4: "200,64,48" },
    },
    map: {
      paper: "#ECE4CF",
      land: "#E8DFC4",
      park: "#C9D9A4",
      water: "#A9CBD6",
      building: "#DCCFA9",
      road: "#FBF6E6",
      casing: "#A89870",
      waterLine: "#8FB7C6",
      ink: "#23394A",
    },
  },
};

/** 模式 → 皮肤 */
export const MODE_SKIN: Record<AppMode, SkinId> = {
  eat: "egg",
  drink: "water",
  toilet: "poop",
  sleep: "pillow",
  explore: "compass",
};
export const DEFAULT_SKIN: SkinId = MODE_SKIN.eat;

export const iconHref = (skin: Skin) => `data:image/svg+xml;utf8,${encodeURIComponent(skin.icon)}`;
