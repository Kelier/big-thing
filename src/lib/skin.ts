import { useEffect } from "react";
import { iconHref, MODE_SKIN, SKINS, type Skin, type SkinId } from "@/data/skins";
import { useDecisionStore } from "@/stores/decision-store";

/** 当前模式对应的皮肤 id */
export const useSkinId = (): SkinId => useDecisionStore((s) => MODE_SKIN[s.mode]);
export const useSkin = (): Skin => SKINS[useSkinId()];

/** 皮肤跟着模式走：同步页面配色变量、站点图标、浏览器地址栏颜色 */
export function useApplySkin(id: SkinId) {
  useEffect(() => {
    const skin = SKINS[id];
    document.documentElement.dataset.skin = id;
    const href = iconHref(skin);
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((l) => {
      l.type = "image/svg+xml";
      l.href = href;
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", skin.themeColor);
  }, [id]);
}
