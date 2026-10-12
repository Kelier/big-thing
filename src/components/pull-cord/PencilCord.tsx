"use client";

import { useEffect, useRef } from "react";
import { canPull, useDecisionStore } from "@/stores/decision-store";
import { CordEngine } from "./engine";

/** 绳子旁的手写批注：随阶段变化，拖拽中隐藏。 */
function labelFor(phase: string, armed: boolean): string | null {
  if (armed) return "松手！";
  switch (phase) {
    case "idle":
      return "拉我！";
    case "cuisineSelected":
      return "再拉一次";
    case "restaurantSelected":
      return "换一家？";
    default:
      return null;
  }
}

export default function PencilCord({ reducedMotion, mapMode = false }: { reducedMotion: boolean; mapMode?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CordEngine | null>(null);
  const hasResult = useDecisionStore((s) => s.categoryId !== null) && !mapMode;
  const phase = useDecisionStore((s) => s.phase);
  const armed = useDecisionStore((s) => s.armed);

  useEffect(() => {
    const canvas = ref.current!;
    const e = new CordEngine(canvas, {
      canStart: () => canPull(useDecisionStore.getState().phase),
      onStart: () => void useDecisionStore.getState().beginDrag(),
      onRelease: (triggered) => useDecisionStore.getState().endDrag(triggered),
      onArmed: (a) => useDecisionStore.getState().setArmed(a),
    });
    engine.current = e;

    const fit = () => {
      const r = canvas.getBoundingClientRect();
      e.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

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
      e.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setOptions({ reducedMotion, hasResult, label: mapMode ? (armed ? "松手！" : null) : labelFor(phase, armed) });
  }, [reducedMotion, hasResult, phase, armed, mapMode]);

  return <canvas ref={ref} className="cord-canvas" aria-hidden />;
}
