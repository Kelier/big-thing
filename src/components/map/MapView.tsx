"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { poi } from "@/services/poi-provider";
import { useDecisionStore } from "@/stores/decision-store";
maplibregl.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
import { FALLBACK_STYLE, loadSketchStyle } from "./sketch-style";

const PIN_SVG = `<svg viewBox="0 0 34 44" aria-hidden><path class="pin__body" d="M17 41 C 9 30, 3 24, 4 15 C 5 7, 11 3, 17 3 C 24 3, 30 8, 30 15 C 31 24, 25 30, 17 41 Z"/><circle class="pin__dot" cx="17" cy="15" r="4.6"/></svg>`;

const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** 随机地点的实时底图：纸面配色的 OpenFreeMap，加手绘风图钉。 */
export default function MapView() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const pins = useRef<Map<string, { marker: Marker; el: HTMLButtonElement }>>(new Map());
  const youRef = useRef<Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [moved, setMoved] = useState(false);

  const mode = useDecisionStore((s) => s.mode);
  const categoryId = useDecisionStore((s) => s.categoryId);
  const placeId = useDecisionStore((s) => s.placeId);
  const userLoc = useDecisionStore((s) => s.userLoc);
  const searching = useDecisionStore((s) => s.searching);
  const result = useDecisionStore((s) => (s.categoryId ? s.placesByKey[`${s.mode}:${s.categoryId}`] : undefined));
  const places = result?.places;
  const tint = categoryId ? poi.findCategory(mode, categoryId)?.tint : undefined;

  // 初始化地图
  useEffect(() => {
    const st = useDecisionStore.getState();
    void st.locate();
    let disposed = false;
    let m: MlMap | null = null;
    (async () => {
      const style = await loadSketchStyle();
      if (disposed || !box.current) return;
      const loc = useDecisionStore.getState().userLoc;
      try {
        const mm: MlMap = new maplibregl.Map({
          container: box.current,
          style: style ?? FALLBACK_STYLE,
          center: loc ? [loc.lng, loc.lat] : [121.4737, 31.2304],
          zoom: 13,
          attributionControl: false,
          localIdeographFontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif",
          pitchWithRotate: false,
          dragRotate: false,
        });
        m = mm;
        mm.touchZoomRotate.disableRotation();
        mm.addControl(
          new maplibregl.AttributionControl({ compact: true, customAttribution: "OpenFreeMap © OpenMapTiles · OpenStreetMap" }),
          "bottom-right",
        );
        mm.on("error", (e) => {
          if (!mm.isStyleLoaded() && !mm.loaded()) console.warn("map error", e.error?.message);
        });
        mm.on("moveend", (e) => {
          if (!(e as unknown as { originalEvent?: unknown }).originalEvent) return;
          const s = useDecisionStore.getState();
          const key = s.categoryId ? `${s.mode}:${s.categoryId}` : null;
          const center = key ? s.placesByKey[key]?.center : undefined;
          if (!center) return setMoved(false);
          const c = mm.getCenter();
          setMoved(dist(center, { lat: c.lat, lng: c.lng }) > 500);
        });
        map.current = mm;
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      pins.current.forEach(({ marker }) => marker.remove());
      pins.current.clear();
      youRef.current?.remove();
      youRef.current = null;
      m?.remove();
      map.current = null;
    };
  }, []);

  // “你在这”
  useEffect(() => {
    const m = map.current;
    if (!m || !userLoc) return;
    if (!youRef.current) {
      const el = document.createElement("div");
      el.className = "you";
      el.innerHTML = `<span class="you__dot"></span><span class="you__tag">${userLoc.approx ? "默认位置" : "你在这"}</span>`;
      youRef.current = new maplibregl.Marker({ element: el }).setLngLat([userLoc.lng, userLoc.lat]).addTo(m);
    } else {
      youRef.current.setLngLat([userLoc.lng, userLoc.lat]);
    }
    if (!useDecisionStore.getState().categoryId) m.easeTo({ center: [userLoc.lng, userLoc.lat], duration: 600 });
  }, [userLoc]);

  // 图钉：随地点列表重建，依次掉落
  useEffect(() => {
    const m = map.current;
    pins.current.forEach(({ marker }) => marker.remove());
    pins.current.clear();
    setMoved(false);
    if (!m || !places?.length) return;
    const withGeo = places.filter((p) => p.lat != null && p.lng != null);
    withGeo.forEach((p, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pin";
      el.style.setProperty("--delay", `${Math.min(i, 14) * 45}ms`);
      el.setAttribute("aria-label", p.name);
      el.innerHTML = `${PIN_SVG}<span class="pin__label">${p.name.replace(/[<>&]/g, "")}</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        useDecisionStore.getState().selectPlace(p.id);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng!, p.lat!]).addTo(m);
      pins.current.set(p.id, { marker, el });
    });
    // 取景：包含用户位置与全部点位，避开左侧面板和右侧绳子
    const b = new maplibregl.LngLatBounds();
    withGeo.forEach((p) => b.extend([p.lng!, p.lat!]));
    const u = useDecisionStore.getState().userLoc;
    if (u) b.extend([u.lng, u.lat]);
    if (!b.isEmpty()) {
      const narrow = window.innerWidth < 760;
      m.fitBounds(b, {
        padding: narrow
          ? { top: 90, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 90 }
          : { top: 100, bottom: 100, left: Math.min(520, window.innerWidth * 0.4) + 40, right: 180 },
        maxZoom: 15.5,
        duration: 900,
      });
    }
  }, [places]);

  // 选中：高亮并飞过去
  useEffect(() => {
    const m = map.current;
    pins.current.forEach(({ el }, id) => {
      el.classList.toggle("is-selected", id === placeId);
      el.style.zIndex = id === placeId ? "5" : "";
    });
    if (!m || !placeId) return;
    const p = places?.find((x) => x.id === placeId);
    if (!p || p.lat == null || p.lng == null) return;
    const narrow = window.innerWidth < 760;
    m.flyTo({
      center: [p.lng, p.lat],
      zoom: Math.max(m.getZoom(), 15.2),
      offset: narrow ? [-30, -window.innerHeight * 0.14] : [(Math.min(520, window.innerWidth * 0.4) - 140) / 2, 0],
      duration: 1100,
      essential: true,
    });
  }, [placeId, places]);

  if (failed) {
    return (
      <div className="map map--failed">
        <p>这台设备打不开地图（需要 WebGL）。</p>
        <p>不影响抽取：拉绳子照样能选出去处。</p>
      </div>
    );
  }

  return (
    <div className="map" style={tint ? ({ "--map-tint": tint } as React.CSSProperties) : undefined}>
      <div ref={box} className="map__canvas" />
      <div className="map__tools">
        {moved && categoryId && (
          <button
            type="button"
            className="map__btn map__btn--search"
            disabled={searching}
            onClick={() => {
              const c = map.current?.getCenter();
              if (c) void useDecisionStore.getState().searchHere(c.lat, c.lng);
            }}
          >
            {searching ? "翻找中…" : "搜这一带 ↻"}
          </button>
        )}
        <button
          type="button"
          className="map__btn"
          aria-label="回到我的位置"
          onClick={async () => {
            const l = useDecisionStore.getState().userLoc ?? (await useDecisionStore.getState().locate());
            map.current?.flyTo({ center: [l.lng, l.lat], zoom: 14.5, duration: 800 });
          }}
        >
          ◎ 我在哪
        </button>
      </div>
      {!categoryId && <p className="map__hint">拉一下右边的绳子，抽个去处，地图上就会冒出地标。</p>}
    </div>
  );
}
