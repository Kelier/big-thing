import type { AppMode } from "@/data/cuisine-categories";

/** OSM 条目命中某分类的规则：cuisine / name 命中任一，或任一 tag 命中。 */
export type OsmMatcher = {
  cuisine?: RegExp;
  name?: RegExp;
  tags?: Array<[key: string, value: RegExp]>;
};

/** 每个分类在高德 / OSM 里怎么搜。仅服务端使用。 */
export type PoiQuery = {
  radius: number;
  amap: { keywords?: string; types?: string };
  osm: OsmMatcher;
};

// amap 的 types 是高德 POI 分类码，已逐个用真实接口验证过：
// 050102 川菜 · 050103 粤菜 · 050108 湘菜 · 050115 西北菜 · 050117 火锅店
// 050202 日本料理 · 050203 韩国料理 · 050500 咖啡厅。没有专属分类码的（面馆/烧烤/轻食）用关键词。
const eat = (radius: number, amap: PoiQuery["amap"], osm: OsmMatcher): PoiQuery => ({ radius, amap, osm });
const go = (radius: number, amap: PoiQuery["amap"], osm: OsmMatcher): PoiQuery => ({ radius, amap, osm });

export const POI_QUERIES: Record<string, PoiQuery> = {
  "eat:sichuan": eat(3000, { types: "050102" }, { cuisine: /sichuan/i, name: /川|蜀|麻辣|椒麻/ }),
  "eat:cantonese": eat(3000, { types: "050103" }, { cuisine: /cantonese|dim_sum/i, name: /粤|茶餐|港式|烧腊|早茶/ }),
  "eat:hotpot": eat(3000, { types: "050117" }, { cuisine: /hot_?pot/i, name: /火锅|锅/ }),
  "eat:japanese": eat(3500, { types: "050202" }, { cuisine: /japanese|sushi|ramen/i, name: /日料|寿司|拉面|居酒屋|日式/ }),
  "eat:noodles": eat(2500, { keywords: "面馆", types: "050000" }, { cuisine: /noodle/i, name: /面|粉/ }),
  "eat:bbq": eat(3500, { keywords: "烧烤", types: "050000" }, { cuisine: /barbecue|bbq|kebab/i, name: /烧烤|串/ }),
  "eat:hunan": eat(3500, { types: "050108" }, { cuisine: /hunan/i, name: /湘/ }),
  "eat:northwest": eat(4000, { types: "050115" }, { cuisine: /uyghur|lanzhou/i, name: /西北|兰州|新疆|肉夹馍|羊肉/ }),
  "eat:korean": eat(4000, { types: "050203" }, { cuisine: /korean/i, name: /韩|烤肉/ }),
  "eat:light": eat(4000, { keywords: "轻食|沙拉", types: "050100|050200|050300" }, { cuisine: /salad|healthy|vegetarian/i, name: /轻食|沙拉/ }),

  // ---- 喝 ----
  // 050500 咖啡厅 · 050600 茶艺馆 · 050700 冷饮店
  "drink:milktea": eat(2500, { keywords: "奶茶", types: "050700" }, { name: /奶茶|茶饮|喜茶|奈雪|蜜雪|古茗|霸王茶姬|茶百道|一点点|沪上阿姨|COCO/i, tags: [["shop", /^tea$/]] }),
  "drink:coffee": eat(2500, { types: "050500" }, { tags: [["amenity", /^cafe$/], ["shop", /^coffee$/]] }),
  "drink:juice": eat(2500, { keywords: "果汁|水果", types: "050700" }, { name: /果汁|榨汁|鲜榨|水果/ }),
  "drink:craftbeer": eat(3500, { keywords: "精酿" }, { name: /精酿|啤酒|craft|brew/i, tags: [["amenity", /^biergarten$/], ["craft", /^brewery$/]] }),
  "drink:bar": eat(3500, { keywords: "清吧|酒吧" }, { tags: [["amenity", /^(bar|pub)$/]] }),
  "drink:tea": eat(3500, { types: "050600" }, { name: /茶馆|茶楼|茶室|茶社/, tags: [["shop", /^tea$/]] }),

  // ---- 拉：200300 公共厕所 · 100100 宾馆酒店 ----
  "toilet:public": eat(1500, { types: "200300" }, { tags: [["amenity", /^toilets$/]] }),
  "toilet:mall": eat(2500, { keywords: "购物中心|商场" }, { tags: [["shop", /^(mall|department_store)$/]] }),
  "toilet:fastfood": eat(2000, { keywords: "麦当劳|肯德基" }, { name: /麦当劳|肯德基|McDonald|KFC/i }),
  "toilet:hotel": eat(2500, { types: "100100" }, { tags: [["tourism", /^hotel$/]] }),

  // ---- 睡：100100 宾馆酒店 · 100200 旅馆招待所 ----
  "sleep:hotel": eat(4000, { types: "100100" }, { tags: [["tourism", /^hotel$/]] }),
  "sleep:bnb": eat(5000, { keywords: "民宿" }, { name: /民宿/, tags: [["tourism", /^(guest_house|apartment|chalet)$/]] }),
  "sleep:inn": eat(4000, { types: "100200" }, { name: /旅馆|旅社|招待所|客栈/, tags: [["tourism", /^motel$/]] }),
  "sleep:hostel": eat(5000, { keywords: "青年旅舍|青旅" }, { tags: [["tourism", /^hostel$/]] }),

  // ---- 地图模式的玩法 ----
  "explore:walk": go(5000, { keywords: "公园" }, { tags: [["leisure", /^park$/]] }),
  "explore:gallery": go(6000, { keywords: "美术馆|展览馆|博物馆" }, { tags: [["tourism", /gallery|museum/]] }),
  "explore:bookstore": go(4000, { keywords: "书店" }, { tags: [["shop", /^books$/]] }),
  "explore:movie": go(5000, { keywords: "电影院" }, { tags: [["amenity", /^cinema$/]] }),
  "explore:craft": go(8000, { keywords: "陶艺|手工|手作" }, { name: /陶艺|手作|木工|香氛/, tags: [["shop", /art|craft|pottery/], ["craft", /pottery|carpenter/]] }),
  "explore:boardgame": go(5000, { keywords: "桌游|密室逃脱" }, { name: /桌游|密室|逃脱/, tags: [["shop", /^games$/]] }),
  "explore:ktv": go(5000, { keywords: "KTV" }, { name: /KTV|量贩/i, tags: [["amenity", /^karaoke_box$/]] }),
  "explore:market": go(6000, { keywords: "夜市" }, { tags: [["amenity", /^marketplace$/]] }),
  "explore:sport": go(5000, { keywords: "羽毛球|攀岩|游泳" }, { tags: [["leisure", /^(sports_centre|swimming_pool)$/]] }),
  "explore:sight": go(8000, { keywords: "景点", types: "110000" }, { tags: [["tourism", /^(attraction|viewpoint)$/]] }),
};

export const queryFor = (mode: AppMode, categoryId: string) => POI_QUERIES[`${mode}:${categoryId}`];

/** 一个位置只拉一次：按 mode 一次取回附近所有候选，再按分类在本地筛选。 */
export const OSM_BULK: Record<AppMode, string[]> = {
  eat: [`["amenity"~"^(restaurant|fast_food|food_court)$"]["name"]`],
  drink: [
    `["amenity"~"^(cafe|bar|pub|biergarten|fast_food|restaurant)$"]["name"]`,
    `["shop"~"^(tea|beverages|coffee)$"]["name"]`,
    `["craft"="brewery"]["name"]`,
  ],
  toilet: [
    `["amenity"="toilets"]`, // 厕所大多没有名字，所以这里不要求 name
    `["shop"~"^(mall|department_store)$"]["name"]`,
    `["amenity"="fast_food"]["name"~"麦当劳|肯德基|McDonald|KFC"]`,
    `["tourism"="hotel"]["name"]`,
  ],
  sleep: [`["tourism"~"^(hotel|motel|guest_house|hostel|apartment|chalet)$"]["name"]`],
  explore: [
    `["leisure"~"^(park|sports_centre|swimming_pool)$"]["name"]`,
    `["tourism"~"^(gallery|museum|attraction|viewpoint)$"]["name"]`,
    `["shop"~"^(books|art|craft|games)$"]["name"]`,
    `["amenity"~"^(cinema|karaoke_box|marketplace)$"]["name"]`,
    `["craft"~"pottery|carpenter"]["name"]`,
  ],
};

/** 上游请求半径的档位：同一位置的所有分类共用一次请求；厕所要近，住宿可以远。 */
export const OSM_BUCKETS: Record<AppMode, number[]> = {
  eat: [2500, 6000, 15000],
  drink: [2500, 6000, 15000],
  toilet: [1500, 4000, 10000],
  sleep: [4000, 10000, 20000],
  explore: [4000, 10000, 20000],
};
