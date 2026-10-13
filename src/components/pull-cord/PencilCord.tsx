"use client";

import { useEffect, useRef } from "react";
import { MODE_SKIN, SKINS } from "@/data/skins";
import { useSkinId } from "@/lib/skin";
import { canPull, useDecisionStore } from "@/stores/decision-store";
import { CordEngine } from "./engine";

export default function PencilCord({ reducedMotion, mapMode = false }: { reducedMotion: boolean; mapMode?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CordEngine | null>(null);
  const hasResult = useDecisionStore((s) => s.categoryId !== null) && !mapMode;
  const skinId = useSkinId();

  useEffect(() => {
    const canvas = ref.current!;
    const e = new CordEngine(canvas, {
      canStart: () => canPull(useDecisionStore.getState().phase),
      onStart: () => void useDecisionStore.getState().beginDrag(),
      onRelease: (triggered) => useDecisionStore.getState().endDrag(triggered),
      onArmed: (a) => useDecisionStore.getState().setArmed(a),
    });
    engine.current = e;
    e.setSkin(SKINS[MODE_SKIN[useDecisionStore.getState().mode]]);

    const fit = () => {
      // 用布局尺寸而不是 getBoundingClientRect：摆动时 canvas 带 CSS 旋转，外接矩形会变大
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const narrow = window.innerWidth < 760;
      // 吃喝拉睡：canvas 横向铺满、只盖住上半部（绳子活动的范围），手柄能一直拖到屏幕边；
      // 地图模式：贴右的窄条。挂点：手机居中，桌面 70%
      const mapNow = useDecisionStore.getState().mode === "explore";
      e.setOptions({ narrow, anchor: mapNow ? 0.5 : narrow ? 0.5 : 0.7 });
      e.resize(w, h, window.devicePixelRatio || 1, window.innerHeight);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    window.addEventListener("resize", fit);

    // 外部“代拉”请求（按钮 / 无障碍）
    let last = useDecisionStore.getState().pullNonce;
    const unsub = useDecisionStore.subscribe((s) => {
      if (s.pullNonce !== last) {
        last = s.pullNonce;
        e.autoPull();
      }
    });
    return () => {
      unsub();
      ro.disconnect();
      window.removeEventListener("resize", fit);
      e.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setSkin(SKINS[skinId]);
  }, [skinId]);

  useEffect(() => {
    engine.current?.setOptions({ reducedMotion, hasResult, onMap: mapMode });
  }, [reducedMotion, hasResult, mapMode]);

  return <canvas ref={ref} className="cord-canvas" aria-hidden />;
}
