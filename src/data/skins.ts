/**
 * 皮肤：一套皮肤 = 页面配色（globals.css 里的 [data-skin]）+ 绳子/手柄造型（引擎）+ 地图底色。
 * 颜色一律写成 "r,g,b" 字符串，方便拼 rgba()。
 */

export type SkinId = "bbq" | "cha" | "egg";
export type RopeKind = "hemp" | "thread" | "braid";
export type HandleKind = "spoon" | "bell" | "egg";

export type Skin = {
  id: SkinId;
  name: string;
  blurb: string;
  /** 切换面板里的小色块：纸 / 强调色 / 绳 a / 绳 b */
  swatch: [string, string, string, string];
  cord: {
    ink: string;
    /** 达到阈值时的荧光笔颜色 */
    hl: string;
    rope: { kind: RopeKind; a: string; b: string };
    /** c1 底色 · c2 暗部 · c3 亮部/条纹 · c4 点缀（勺心、蛋黄） */
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

export const SKINS: Record<SkinId, Skin> = {
  bbq: {
    id: "bbq",
    name: "夜市烧烤",
    blurb: "奶油黄纸、辣椒红，麻绳拴木汤勺",
    swatch: ["#f8e9c4", "#d63a1f", "#f4dca0", "#b06c2c"],
    cord: {
      ink: "59,34,20",
      hl: "255,174,0",
      rope: { kind: "hemp", a: "244,220,160", b: "176,108,44" },
      handle: { kind: "spoon", c1: "205,143,78", c2: "139,85,36", c3: "236,196,140", c4: "120,70,30" },
    },
    map: {
      paper: "#F7E8C3",
      land: "#F1DDAE",
      park: "#D9DDA0",
      water: "#C9DCCF",
      building: "#EBCF98",
      road: "#FFF6DC",
      casing: "#C9A56B",
      waterLine: "#B5CDBE",
      ink: "#3B2214",
    },
  },
  cha: {
    id: "cha",
    name: "港式茶餐厅",
    blurb: "瓷砖青绿、番茄红，红白棉线挂搪瓷铃",
    swatch: ["#cfe8dc", "#e8402a", "#e2402c", "#fffbf0"],
    cord: {
      ink: "24,52,48",
      hl: "255,244,170",
      rope: { kind: "thread", a: "226,64,44", b: "255,251,240" },
      handle: { kind: "bell", c1: "232,64,44", c2: "170,38,26", c3: "255,251,240", c4: "200,196,180" },
    },
    map: {
      paper: "#CFE6DA",
      land: "#C2DED0",
      park: "#A9D3A8",
      water: "#9ED0D6",
      building: "#E8EFE0",
      road: "#FFFBEF",
      casing: "#7FAE9E",
      waterLine: "#86BFC6",
      ink: "#1F3A36",
    },
  },
  egg: {
    id: "egg",
    name: "溏心蛋食堂",
    blurb: "蛋奶黄纸、橙色，面条绳子吊溏心蛋",
    swatch: ["#fff0b8", "#f28a1a", "#ffaa28", "#ffda64"],
    cord: {
      ink: "74,44,20",
      hl: "255,130,40",
      rope: { kind: "braid", a: "255,170,40", b: "255,218,100" },
      handle: { kind: "egg", c1: "255,253,244", c2: "236,196,120", c3: "255,255,255", c4: "247,163,37" },
    },
    map: {
      paper: "#FFEFB0",
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
};

export const SKIN_ORDER: SkinId[] = ["bbq", "cha", "egg"];
export const DEFAULT_SKIN: SkinId = "bbq";
export const SKIN_STORAGE_KEY = "wte-skin";

export const isSkinId = (v: unknown): v is SkinId => typeof v === "string" && v in SKINS;
