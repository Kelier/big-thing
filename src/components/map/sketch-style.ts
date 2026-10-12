import type { StyleSpecification } from "maplibre-gl";
import { SKINS, type Skin, type SkinId } from "@/data/skins";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** 无网络 / 样式拉取失败时的兜底：纯纸面，保证标记仍能显示 */
export function fallbackStyle(skin: Skin): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": skin.map.paper } }] };
}

type Layer = { id: string; type: string; paint?: Record<string, unknown>; layout?: Record<string, unknown>; ["source-layer"]?: string };

let raw: Promise<StyleSpecification & { layers: Layer[] }> | null = null;

/** 取 OpenFreeMap positron 样式并换成当前皮肤的配色（只改颜色与字段，不动几何）。 */
export async function loadSketchStyle(id: SkinId): Promise<StyleSpecification> {
  const skin = SKINS[id];
  const m = skin.map;
  try {
    raw ??= fetch(STYLE_URL).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
    // 同一份原始样式会被多个皮肤复用，深拷贝后再改
    const style = structuredClone(await raw);
    for (const l of style.layers) {
      const lid = l.id;
      const paint = (l.paint ??= {});
      if (l.type === "background") paint["background-color"] = m.paper;
      else if (l.type === "fill") {
        let c = m.land;
        if (/park|wood|forest|grass|green|landcover|pitch/.test(lid)) c = m.park;
        else if (/water/.test(lid)) c = m.water;
        else if (/building/.test(lid)) c = m.building;
        paint["fill-color"] = c;
        if ("fill-outline-color" in paint) paint["fill-outline-color"] = `rgba(${skin.cord.ink},0.18)`;
      } else if (l.type === "line") {
        if (/water/.test(lid)) paint["line-color"] = m.waterLine;
        else if (/casing|bridge.*casing|tunnel.*casing/.test(lid)) paint["line-color"] = m.casing;
        else if (/boundary|admin/.test(lid)) paint["line-color"] = `rgba(${skin.cord.ink},0.35)`;
        else paint["line-color"] = m.road;
      } else if (l.type === "symbol") {
        paint["text-color"] = m.ink;
        paint["text-halo-color"] = m.paper;
        paint["text-halo-width"] = 1.6;
        const layout = (l.layout ??= {});
        // 优先中文名，没有再退回默认名
        if (layout["text-field"]) layout["text-field"] = ["coalesce", ["get", "name:zh"], ["get", "name:nonlatin"], ["get", "name"]];
      }
    }
    return style;
  } catch {
    raw = null;
    return fallbackStyle(skin);
  }
}
