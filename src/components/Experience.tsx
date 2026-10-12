"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ModeSwitcher } from "@/components/layout/ModeSwitcher";
import { SketchDefs } from "@/components/layout/SketchDefs";
import { DecisionStage } from "@/components/decision/DecisionStage";
import PencilCord from "@/components/pull-cord/PencilCord";
const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false });
import { useReducedMotion } from "@/lib/hooks";
import { useDecisionStore } from "@/stores/decision-store";
import { useSkinStore } from "@/stores/skin-store";

export function Experience() {
  const reduced = useReducedMotion();
  const phase = useDecisionStore((s) => s.phase);
  const mapMode = useDecisionStore((s) => s.mode) === "explore";
  const [impact, setImpact] = useState(false);

  useEffect(() => useSkinStore.getState().restore(), []);

  // 抽取瞬间的轻微冲击
  useEffect(() => {
    if (phase !== "releasing" || reduced) return;
    setImpact(true);
    const t = setTimeout(() => setImpact(false), 220);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  return (
    <main className={`app${mapMode ? " app--map" : ""}${impact ? " is-impact" : ""}`}>
      <SketchDefs />
      {mapMode && <MapView />}
      <div className="tint" aria-hidden />
      <div className="frame" aria-hidden />
      <div className="stage-canvas">
        <PencilCord reducedMotion={reduced} mapMode={mapMode} />
      </div>
      <Header />
      <DecisionStage reducedMotion={reduced} />
      <ModeSwitcher />
    </main>
  );
}
