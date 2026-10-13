"use client";

import { useEffect, useState } from "react";
import { SKINS } from "@/data/skins";
import { useSkinId } from "@/lib/skin";
import { useDecisionStore } from "@/stores/decision-store";
import { cordLayout } from "./engine";

/** 绳子旁的手写批注：随阶段变化。 */
function labelFor(phase: string): string | null {
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

/**
 * 批注是普通 DOM，不在 canvas 里画：这样 canvas 才能缩成一条窄带（面积小 → 光栅化和合成都便宜），
 * 位置由引擎导出的静止布局公式算出。没有任何持续动画，只有一次淡入淡出。
 */
export function CordLabel() {
  const phase = useDecisionStore((s) => s.phase);
  const mapMode = useDecisionStore((s) => s.mode) === "explore";
  const hasResult = useDecisionStore((s) => s.categoryId !== null);
  const skinId = useSkinId();
  const [view, setView] = useState({ h: 800, narrow: false });
  const [text, setText] = useState("拉我！");

  useEffect(() => {
    const sync = () => setView({ h: window.innerHeight, narrow: window.innerWidth < 760 });
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const want = mapMode ? null : labelFor(phase);
  // 淡出时保留上一句，免得文字先消失再淡出
  useEffect(() => {
    if (want) setText(want);
  }, [want]);

  const { hy, half } = cordLayout(view.h, view.narrow, hasResult && !mapMode, SKINS[skinId].cord.handle.kind);
  return (
    <div
      className={`cord-label${want ? " is-on" : ""}${view.narrow ? " is-narrow" : ""}`}
      style={{ top: hy, ["--half" as string]: `${half}px` }}
      aria-hidden
    >
      <span className="cord-label__text">{text}</span>
      <svg className="cord-label__arrow" viewBox="0 0 64 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M60 6 C 40 2, 22 8, 8 20" />
        <path d="M8 20 L 9 9 M8 20 L 19 19" />
      </svg>
    </div>
  );
}
