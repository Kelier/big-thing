import type { Category, Place } from "@/data/cuisine-categories";

export type SortMode = "distance" | "price";

const rand = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 纯随机选分类，并抑制最近出现过的结果。 */
export function pickCategory(pool: readonly Category[], recentIds: readonly string[] = []): Category {
  const fresh = pool.filter((c) => !recentIds.includes(c.id));
  return rand(fresh.length > 0 ? fresh : pool);
}

/**
 * 在分类内抽一家：按排序偏好取最优的前 N 家作为候选，再随机。
 * - 价格缺失的地点（真实数据常见）排在价格排序的最后；
 * - 刚展示过的、最近抽到过的尽量避开。
 */
export function pickPlace(
  places: readonly Place[],
  sort: SortMode,
  avoidIds: readonly string[] = [],
): Place {
  const key = (p: Place) => (sort === "distance" ? p.distanceM : (p.price ?? Number.POSITIVE_INFINITY));
  // 候选池随数据量放大：真实数据有二三十家时，只在最近 3 家里转会很无聊
  const topN = places.length > 12 ? 6 : places.length > 6 ? 4 : 3;
  const ranked = [...places].sort((a, b) => key(a) - key(b)).slice(0, topN);
  const fresh = ranked.filter((p) => !avoidIds.includes(p.id));
  return rand(fresh.length > 0 ? fresh : ranked);
}
