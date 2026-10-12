import type { Place } from "@/data/cuisine-categories";
import { OSM_BULK, type OsmMatcher, type PoiQuery } from "./poi-queries";
import type { AppMode } from "@/data/cuisine-categories";

/** 仅服务端使用：向高德 / Overpass 取数据并统一成 Place。 */

export type PoiSource = "amap" | "osm";

// ---------- 坐标 ----------
const A = 6378245.0;
const EE = 0.00669342162296594323;
const outOfChina = (lng: number, lat: number) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

function tLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}
function tLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}
/** 浏览器给的是 WGS-84，高德用 GCJ-02。 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  const dLat0 = tLat(lng - 105, lat - 35);
  const dLng0 = tLng(lng - 105, lat - 35);
  const rad = (lat / 180) * Math.PI;
  const magic = 1 - EE * Math.sin(rad) ** 2;
  const sq = Math.sqrt(magic);
  const dLat = (dLat0 * 180) / (((A * (1 - EE)) / (magic * sq)) * Math.PI);
  const dLng = (dLng0 * 180) / ((A / sq) * Math.cos(rad) * Math.PI);
  return [lng + dLng, lat + dLat];
}

/** 反向转换（迭代逼近）：高德返回 GCJ-02，地图底图用 WGS-84，显示前要转回来，否则图钉会偏几百米。 */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let wl = lng;
  let wt = lat;
  for (let i = 0; i < 4; i++) {
    const [gl, gt] = wgs84ToGcj02(wl, wt);
    wl += lng - gl;
    wt += lat - gt;
  }
  return [wl, wt];
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(a)));
}

const markerUrl = (lng: number, lat: number, name: string, coordinate: "gaode" | "wgs84") =>
  `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(name)}&coordinate=${coordinate}&callnative=1`;

const str = (v: unknown) => (typeof v === "string" ? v : "");

// ---------- 高德：周边搜索 v5 ----------
type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  address?: unknown;
  adname?: unknown;
  location?: string;
  distance?: string;
  business?: { cost?: unknown; tag?: unknown; business_area?: unknown };
};

export function parseAmap(json: { status?: string; info?: string; pois?: AmapPoi[] }): Place[] {
  if (json.status !== "1") throw new Error(`amap: ${json.info ?? "unknown error"}`);
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const p of json.pois ?? []) {
    const name = str(p.name).trim();
    const [lng, lat] = str(p.location).split(",").map(Number);
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat) || seen.has(name)) continue;
    seen.add(name);
    const cost = parseFloat(str(p.business?.cost));
    const [wLng, wLat] = gcj02ToWgs84(lng, lat);
    const tag = str(p.business?.tag).split(/[,，;；]/).filter(Boolean).slice(0, 3).join(" · ");
    out.push({
      id: `amap-${p.id ?? name}`,
      name,
      // 高德的 address 为空时会返回 []，所以要判断类型
      area: str(p.business?.business_area) || str(p.adname) || str(p.address),
      distanceM: Math.round(Number(p.distance)) || 0,
      price: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : null,
      signature: tag || str(p.type).split(";").pop() || "",
      // 展示坐标统一用 WGS-84（与底图一致）；导航链接仍用原始 GCJ-02
      lat: wLat,
      lng: wLng,
      navUrl: markerUrl(lng, lat, name, "gaode"),
    });
  }
  return out;
}

const amapCache = new Map<string, { at: number; places: Place[] }>();
const amapInflight = new Map<string, Promise<Place[]>>();
const AMAP_TTL = 10 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function amapRequest(opts: { key: string; lat: number; lng: number; radius: number; q: PoiQuery["amap"] }) {
  const [gLng, gLat] = wgs84ToGcj02(opts.lng, opts.lat);
  const url = new URL("https://restapi.amap.com/v5/place/around");
  url.searchParams.set("key", opts.key);
  url.searchParams.set("location", `${gLng.toFixed(6)},${gLat.toFixed(6)}`);
  if (opts.q.keywords) url.searchParams.set("keywords", opts.q.keywords);
  if (opts.q.types) url.searchParams.set("types", opts.q.types);
  url.searchParams.set("radius", String(opts.radius));
  url.searchParams.set("sortrule", "distance");
  url.searchParams.set("page_size", "25");
  url.searchParams.set("show_fields", "business");
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`amap http ${res.status}`);
  return parseAmap(await res.json());
}

/**
 * 高德周边搜索。个人 key 的 QPS 很低（连发会返回 CUQPS_HAS_EXCEEDED_THE_LIMIT），
 * 所以：10 分钟缓存 + 同请求合并 + 撞限流时退避重试。
 */
export function amapAround(opts: { key: string; lat: number; lng: number; radius: number; q: PoiQuery["amap"] }): Promise<Place[]> {
  const cacheKey = `${opts.q.types ?? ""}|${opts.q.keywords ?? ""}|${opts.lat.toFixed(3)}|${opts.lng.toFixed(3)}|${opts.radius}`;
  const hit = amapCache.get(cacheKey);
  if (hit && Date.now() - hit.at < AMAP_TTL) return Promise.resolve(hit.places);
  const pending = amapInflight.get(cacheKey);
  if (pending) return pending;

  const run = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const places = await amapRequest(opts);
        amapCache.set(cacheKey, { at: Date.now(), places });
        return places;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (attempt < 2 && /QPS|LIMIT/i.test(msg)) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  })().finally(() => amapInflight.delete(cacheKey));
  amapInflight.set(cacheKey, run);
  return run;
}

// ---------- OpenStreetMap：Overpass ----------
type OsmEl = { id: number; type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

// OSM 的 cuisine 是英文标签；只翻译认识的，其余丢掉，避免中文卡片里冒出英文
const CUISINE_ZH: Record<string, string> = {
  noodle: "面食", noodles: "面食", ramen: "拉面", sichuan: "川菜", cantonese: "粤菜", hunan: "湘菜",
  hot_pot: "火锅", hotpot: "火锅", japanese: "日料", sushi: "寿司", korean: "韩餐", barbecue: "烧烤",
  bbq: "烧烤", kebab: "烤串", dim_sum: "点心", salad: "沙拉", healthy: "轻食", vegetarian: "素食",
  chinese: "中餐", coffee_shop: "咖啡", cake: "蛋糕", dessert: "甜品", pizza: "披萨", burger: "汉堡",
  chicken: "炸鸡", seafood: "海鲜", steak_house: "牛排", uyghur: "新疆菜", lanzhou: "兰州菜",
};
const cuisineLabel = (raw: string | undefined) =>
  [...new Set((raw ?? "").split(";").map((c) => CUISINE_ZH[c.trim().toLowerCase()]).filter(Boolean))]
    .slice(0, 3)
    .join(" · ");

export type OsmItem = { place: Place; tags: Record<string, string>; generic?: boolean };

/** 厕所 / 酒店等的补充说明（OSM 标签 → 中文） */
function extraLabel(t: Record<string, string>) {
  const parts: string[] = [];
  if (t.amenity === "toilets") {
    if (t.fee === "no") parts.push("免费");
    else if (t.fee === "yes") parts.push("收费");
    if (t.wheelchair === "yes") parts.push("无障碍");
    if (t.changing_table === "yes") parts.push("母婴台");
    if (t.access === "customers") parts.push("限顾客");
  }
  if (t.tourism === "hotel" && t.stars) parts.push(`${t.stars}星`);
  return parts.join(" · ");
}

export function parseOverpass(json: { elements?: OsmEl[] }, lat: number, lng: number): OsmItem[] {
  const out: OsmItem[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    let name = (t["name:zh"] || t.name || "").trim();
    const plat = el.lat ?? el.center?.lat;
    const plng = el.lon ?? el.center?.lon;
    // 公共厕所多数没有名字：给个通用名，用坐标区分
    const generic = !name && t.amenity === "toilets";
    if (generic) name = t.operator ? `公共厕所（${t.operator}）` : "公共厕所";
    if (!name || plat == null || plng == null) continue;
    out.push({
      generic,
      tags: t,
      place: {
        id: `osm-${el.type}${el.id}`,
        name,
        area: t["addr:suburb"] || t["addr:district"] || t["addr:street"] || "",
        distanceM: haversine(lat, lng, plat, plng),
        price: null,
        signature: cuisineLabel(t.cuisine) || extraLabel(t),
        lat: plat,
        lng: plng,
        navUrl: markerUrl(plng, plat, name, "wgs84"),
      },
    });
  }
  return out;
}

/** 按分类规则筛选、去重、按距离排序。 */
export function classifyOsm(items: OsmItem[], m: OsmMatcher, maxDistance: number): Place[] {
  const seen = new Set<string>();
  return items
    .filter(({ tags, place, generic }) => {
      const dedupeKey = generic ? place.id : place.name;
      if (place.distanceM > maxDistance || seen.has(dedupeKey)) return false;
      const hit =
        (m.cuisine && tags.cuisine && m.cuisine.test(tags.cuisine)) ||
        (m.name && m.name.test(place.name)) ||
        m.tags?.some(([k, re]) => tags[k] && re.test(tags[k]));
      if (hit) seen.add(dedupeKey);
      return !!hit;
    })
    .map((i) => i.place)
    .sort((a, b) => a.distanceM - b.distanceM);
}

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function overpassOnce(endpoint: string, body: string, lat: number, lng: number) {
  const res = await fetch(endpoint, {
    method: "POST",
    body: new URLSearchParams({ data: body }),
    headers: { "User-Agent": "what-to-eat/0.1 (personal project)" },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`overpass http ${res.status}`);
  return parseOverpass(await res.json(), lat, lng);
}

// 公共 Overpass 经常 429/504：缓存 + 请求合并 + 重试，尽量少打扰它
const TTL = 30 * 60_000;
const cache = new Map<string, { at: number; items: OsmItem[] }>();
const inflight = new Map<string, Promise<OsmItem[]>>();

/** 一次取回附近某类的全部候选（一个位置 × 一个 mode 只请求一次）。 */
export function overpassBulk(opts: { mode: AppMode; lat: number; lng: number; radius: number }): Promise<OsmItem[]> {
  // 缓存键按约 1km 网格取整，邻近位置共用结果；distance 仍按真实位置重算
  const key = `${opts.mode}|${opts.lat.toFixed(2)}|${opts.lng.toFixed(2)}|${opts.radius}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    // 复用缓存时按当前位置重算距离
    return Promise.resolve(
      hit.items.map((i) => ({
        ...i,
        place: { ...i.place, distanceM: haversine(opts.lat, opts.lng, i.place.lat!, i.place.lng!) },
      })),
    );
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const around = `(around:${opts.radius},${opts.lat},${opts.lng})`;
  const body = `[out:json][timeout:10];(${OSM_BULK[opts.mode].map((f) => `nwr${f}${around};`).join("")});out center 1200;`;
  const run = (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 两个镜像同时请求，谁先成功用谁
        const items = await Promise.any(OVERPASS.map((e) => overpassOnce(e, body, opts.lat, opts.lng)));
        cache.set(key, { at: Date.now(), items });
        return items;
      } catch (e) {
        lastErr = e;
        await sleep(800);
      }
    }
    // 上游挂了：有过期缓存就先用着，总比什么都没有强
    if (hit) return hit.items;
    const reasons = lastErr instanceof AggregateError ? lastErr.errors.map((x) => String(x?.message ?? x)).join("; ") : String(lastErr);
    throw new Error(`overpass failed: ${reasons}`);
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
