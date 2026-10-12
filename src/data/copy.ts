import type { AppMode } from "./cuisine-categories";

export type ModeCopy = {
  brand: string;
  /** 底栏切换用的单字与英文 */
  chip: string;
  chipEn: string;
  titleTop: string;
  titleBottom: string;
  eyebrow: string;
  sub: string;
  cta: string;
  /** 揭晓分类时的判词 */
  verdict: (name: string) => string;
  /** 地点的叫法：餐厅 / 去处 / 住处 … */
  placeLabel: string;
  /** 价格字段的叫法 */
  priceLabel: string;
  /** “换菜系”“换品类”… */
  categoryNoun: string;
};

const FATE = "别问，问就是天意。";

export const MODE_COPY: Record<AppMode, ModeCopy> = {
  eat: {
    brand: "今天吃点啥",
    chip: "吃",
    chipEn: "EAT",
    titleTop: "今天吃点",
    titleBottom: "啥？",
    eyebrow: "DECISION FATIGUE? NO MORE.",
    sub: "你的胃不想开会了。",
    cta: "开始替我做决定",
    verdict: (n) => `今天吃${n}。${FATE}`,
    placeLabel: "餐厅",
    priceLabel: "人均",
    categoryNoun: "菜系",
  },
  drink: {
    brand: "今天喝点啥",
    chip: "喝",
    chipEn: "DRINK",
    titleTop: "今天喝点",
    titleBottom: "啥？",
    eyebrow: "THIRSTY? PULL THE CORD.",
    sub: "你的嘴唇在等一个答案。",
    cta: "开始替我做决定",
    verdict: (n) => `今天喝${n}。${FATE}`,
    placeLabel: "店",
    priceLabel: "人均",
    categoryNoun: "饮品",
  },
  toilet: {
    brand: "今天去哪拉",
    chip: "拉",
    chipEn: "WC",
    titleTop: "今天去哪",
    titleBottom: "拉？",
    eyebrow: "NATURE IS CALLING.",
    sub: "别憋着，天意来导航。",
    cta: "快帮我找一个",
    verdict: (n) => `今天去${n}解决。${FATE}`,
    placeLabel: "厕所",
    priceLabel: "费用",
    categoryNoun: "类型",
  },
  sleep: {
    brand: "今天睡哪儿",
    chip: "睡",
    chipEn: "SLEEP",
    titleTop: "今天睡在",
    titleBottom: "哪？",
    eyebrow: "TIRED? LET FATE BOOK IT.",
    sub: "你的床今天不一定是你的床。",
    cta: "开始替我做决定",
    verdict: (n) => `今晚住${n}。${FATE}`,
    placeLabel: "住处",
    priceLabel: "每晚",
    categoryNoun: "类型",
  },
  explore: {
    brand: "今天干点啥",
    chip: "玩",
    chipEn: "MAP",
    titleTop: "今天干点",
    titleBottom: "啥？",
    eyebrow: "BORED? PULL THE CORD.",
    sub: "随机一个玩法，地图上见。",
    cta: "随机一个玩法",
    verdict: (n) => `今天就：${n}。${FATE}`,
    placeLabel: "去处",
    priceLabel: "门票",
    categoryNoun: "玩法",
  },
};

export const PULL_HINTS = {
  idle: "拉住，往下拽",
  armed: "够了，松手！",
  retry: "再拉一次，抽一家",
} as const;
