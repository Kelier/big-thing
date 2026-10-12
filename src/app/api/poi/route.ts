import { NextRequest, NextResponse } from "next/server";
import { OSM_BUCKETS, queryFor } from "@/services/poi-queries";
import { amapAround, classifyOsm, overpassBulk, type PoiSource } from "@/services/poi-server";
import type { AppMode } from "@/data/cuisine-categories";
import type { Place } from "@/data/cuisine-categories";

export const dynamic = "force-dynamic";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

async function search(mode: AppMode, lat: number, lng: number, radius: number, q: NonNullable<ReturnType<typeof queryFor>>) {
  const key = process.env.AMAP_KEY;
  let amapError: string | undefined;
  if (key) {
    try {
      return { source: "amap" as PoiSource, places: await amapAround({ key, lat, lng, radius, q: q.amap }) };
    } catch (e) {
      // 高德失败（额度 / key 配置 / 网络）就降级到 OSM，不让页面坏掉
      amapError = e instanceof Error ? e.message.replace(key, "***") : "amap error";
      console.warn("[poi] amap failed, falling back to OSM:", amapError);
    }
  }
  // OSM：按位置一次批量取回，再本地按分类筛选
  // 半径取固定档位，让同一位置的所有分类共用一次上游请求
  const buckets = OSM_BUCKETS[mode];
  const bulkRadius = buckets.find((b) => b >= radius) ?? buckets[buckets.length - 1];
  const items = await overpassBulk({ mode, lat, lng, radius: bulkRadius });
  return { source: "osm" as PoiSource, places: classifyOsm(items, q.osm, radius), amapError };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const mode = sp.get("mode");
  const cat = sp.get("cat") ?? "";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "bad location" }, { status: 400 });
  }
  if (mode !== "eat" && mode !== "drink" && mode !== "toilet" && mode !== "sleep" && mode !== "explore") {
    return NextResponse.json({ error: "bad mode" }, { status: 400 });
  }
  const q = queryFor(mode, cat);
  if (!q) return NextResponse.json({ error: "unknown category" }, { status: 400 });

  try {
    let radius = clamp(Number(sp.get("radius")) || q.radius, 500, 20000);
    let r = await search(mode, lat, lng, radius, q);
    // 附近太冷清：把半径放大 3 倍再试一次
    if (r.places.length < 3 && radius < 15000) {
      radius = Math.min(radius * 3, 20000);
      r = await search(mode, lat, lng, radius, q);
    }
    const places: Place[] = r.places.slice(0, 30);
    return NextResponse.json(
      { source: r.source, places, radius },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (e) {
    console.warn("[poi] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "upstream failed" }, { status: 502 });
  }
}
