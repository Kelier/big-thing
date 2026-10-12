import type { StyleSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const PAPER = "#F4EEE1";
const INK = "#2B2926";

/** 无网络 / 样式拉取失败时的兜底：纯纸面，保证标记仍能显示 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": PAPER } }],
};

type Layer = { id: string; type: string; paint?: Record<string, unknown>; layout?: Record<string, unknown>; ["source-layer"]?: string };

let cache: Promise<StyleSpecification> | null = null;

/** 取 OpenFreeMap positron 样式并改成纸面铅笔配色（只改颜色与字段，不动几何）。 */
export function loadSketchStyle(): Promise<StyleSpecification> {
  if (cache) return cache;
  cache = (async () => {
    try {
      const res = await fetch(STYLE_URL);
      if (!res.ok) throw new Error(String(res.status));
      const style = (await res.json()) as StyleSpecification & { layers: Layer[] };
      for (const l of style.layers as Layer[]) {
        const id = l.id;
        const paint = (l.paint ??= {});
        if (l.type === "background") paint["background-color"] = PAPER;
        else if (l.type === "fill") {
          let c = "#EDE5D3";
          if (/park|wood|forest|grass|green|landcover|pitch/.test(id)) c = "#DCE3CB";
          else if (/water/.test(id)) c = "#CBD6D5";
          else if (/building/.test(id)) c = "#E6DCC8";
          paint["fill-color"] = c;
          if ("fill-outline-color" in paint) paint["fill-outline-color"] = "rgba(43,41,38,0.18)";
        } else if (l.type === "line") {
          if (/water/.test(id)) paint["line-color"] = "#BCCBCB";
          else if (/casing|bridge.*casing|tunnel.*casing/.test(id)) paint["line-color"] = "#9B9384";
          else if (/boundary|admin/.test(id)) paint["line-color"] = "rgba(43,41,38,0.35)";
          else paint["line-color"] = "#FBF8F1";
        } else if (l.type === "symbol") {
          paint["text-color"] = INK;
          paint["text-halo-color"] = PAPER;
          paint["text-halo-width"] = 1.6;
          const layout = (l.layout ??= {});
          // 优先中文名，没有再退回默认名
          if (layout["text-field"]) layout["text-field"] = ["coalesce", ["get", "name:zh"], ["get", "name:nonlatin"], ["get", "name"]];
        }
      }
      return style;
    } catch {
      cache = null;
      return FALLBACK_STYLE;
    }
  })();
  return cache;
}
