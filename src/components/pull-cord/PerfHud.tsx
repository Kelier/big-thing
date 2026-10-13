"use client";

import { useEffect, useRef, useState } from "react";
import { useDecisionStore } from "@/stores/decision-store";
import { cordPerf } from "./engine";

/**
 * 真机性能面板：地址后加 ?perf 才会出现。每 0.5 秒统计一次：
 * - fps / 最长一帧：整页的实际帧率（拖动时看它掉不掉）
 * - cord：拉绳引擎每帧自己的耗时（物理 + 绘制，JS 侧）。
 *   如果 cord 很小但 fps 很低，瓶颈就在浏览器的光栅化/合成（GPU/显存），而不是我们的脚本。
 */
export function PerfHud() {
  const [on, setOn] = useState(false);
  const [text, setText] = useState("perf…");
  const phase = useDecisionStore((s) => s.phase);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    setOn(new URLSearchParams(location.search).has("perf"));
  }, []);

  useEffect(() => {
    if (!on) return;
    cordPerf.on = true;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let worst = 0;
    let winStart = last;
    const tick = (now: number) => {
      const d = now - last;
      last = now;
      frames++;
      worst = Math.max(worst, d);
      if (now - winStart >= 500) {
        const fps = (frames * 1000) / (now - winStart);
        const c = document.querySelector<HTMLCanvasElement>("canvas.cord-canvas");
        const cord = cordPerf.n ? `${(cordPerf.sum / cordPerf.n).toFixed(1)}ms (max ${cordPerf.max.toFixed(1)})` : "休眠";
        setText(
          `${cordPerf.renderer}  fps ${fps.toFixed(0)}  最长帧 ${worst.toFixed(0)}ms\ncord ${cord}\ncanvas ${c?.width}×${c?.height}  dpr ${window.devicePixelRatio}\n${phaseRef.current}`,
        );
        frames = 0;
        worst = 0;
        winStart = now;
        cordPerf.n = 0;
        cordPerf.sum = 0;
        cordPerf.max = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      cordPerf.on = false;
    };
  }, [on]);

  if (!on) return null;
  return (
    <pre
      aria-hidden
      style={{
        position: "fixed", top: 4, left: 4, zIndex: 9999, margin: 0, padding: "4px 6px", pointerEvents: "none",
        font: "11px/1.35 ui-monospace, Menlo, monospace", color: "#0f0", background: "rgba(0,0,0,0.72)", borderRadius: 4, whiteSpace: "pre",
      }}
    >
      {text}
    </pre>
  );
}
