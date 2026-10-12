import { CATEGORIES_BY_MODE, type AppMode, type Category, type Place } from "@/data/cuisine-categories";

/**
 * 客户端的地点服务：分类是本地的，具体地点来自 /api/poi（高德或 OSM）。
 * UI 只依赖这里，不关心数据来自哪家；任何一步失败都退回示例数据，保证页面不坏。
 */

export type PlaceSource = "amap" | "osm" | "mock";
export type Loc = { lat: number; lng: number; /** 没拿到真实定位，用的是默认城市 */ approx?: boolean };

/** 没有定位时地图模式使用的默认中心：上海人民广场 */
export const DEFAULT_LOC: Loc = { lat: 31.2304, lng: 121.4737, approx: true };
export type PlacesResult = { places: Place[]; source: PlaceSource; note?: string; /** 这批结果是围绕哪个点搜的 */ center?: { lat: number; lng: number } };

export const poi = {
  getCategories: (mode: AppMode): Category[] => CATEGORIES_BY_MODE[mode],
  findCategory: (mode: AppMode, id: string): Category | undefined => CATEGORIES_BY_MODE[mode].find((c) => c.id === id),
};

export const sourceLabel = (r: PlacesResult | undefined) => {
  if (!r) return "";
  const base = r.source === "amap" ? "数据来自高德地图" : r.source === "osm" ? "数据来自 OpenStreetMap" : (r.note ?? "示例数据");
  return r.source !== "mock" && r.note ? `${base} · ${r.note}` : base;
};

/** 示例商家的导航：搜索附近同类地点 */
export const fallbackNavUrl = (category: Category) =>
  `https://uri.amap.com/search?keyword=${encodeURIComponent(category.name)}`;

let locCache: { at: number; loc: Loc | null } | null = null;
let locInflight: Promise<Loc | null> | null = null;

/** 定位：缓存 10 分钟；用户拒绝或超时返回 null。 */
export function getLocation(): Promise<Loc | null> {
  if (locCache && Date.now() - locCache.at < 10 * 60_000 && locCache.loc) return Promise.resolve(locCache.loc);
  if (locInflight) return locInflight;
  locInflight = new Promise<Loc | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60_000 },
    );
  }).then((loc) => {
    locCache = { at: Date.now(), loc };
    locInflight = null;
    return loc;
  });
  return locInflight;
}

const mock = (category: Category, note: string): PlacesResult => ({ places: category.places, source: "mock", note });

/**
 * 取某分类的候选地点。center 不传则用用户定位；
 * 地图模式拿不到定位时用默认城市（否则整个模式没法演示），其它模式退回示例数据。
 */
export async function loadPlaces(mode: AppMode, category: Category, center?: Loc): Promise<PlacesResult> {
  let loc: Loc | null = center ?? (await getLocation());
  let approxNote: string | undefined;
  if (!loc) {
    if (mode !== "explore") return mock(category, "未获取到定位 · 当前为示例数据");
    loc = DEFAULT_LOC;
    approxNote = "未获取到定位 · 以上海人民广场为例";
  }
  try {
    // 坐标只保留 3 位小数（约百米），既够用也少暴露一点
    const qs = new URLSearchParams({
      mode,
      cat: category.id,
      lat: loc.lat.toFixed(3),
      lng: loc.lng.toFixed(3),
    });
    const res = await fetch(`/api/poi?${qs}`, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { source: PlaceSource; places: Place[] };
    if (!json.places?.length) return mock(category, "附近没找到合适的 · 当前为示例数据");
    return { places: json.places, source: json.source, note: approxNote, center: { lat: loc.lat, lng: loc.lng } };
  } catch {
    return mock(category, "地点服务暂时不可用 · 当前为示例数据");
  }
}
