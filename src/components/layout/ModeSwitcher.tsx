"use client";

import { ROLL_MODES, type RollMode } from "@/data/cuisine-categories";
import { useDecisionStore } from "@/stores/decision-store";

const CHIP: Record<RollMode, string> = { eat: "吃", drink: "喝", toilet: "拉", sleep: "睡" };
const CHIP_TITLE: Record<RollMode, string> = { eat: "今天吃什么", drink: "今天喝什么", toilet: "今天去哪拉", sleep: "今天睡在哪" };

export function ModeSwitcher() {
  const mode = useDecisionStore((s) => s.mode);
  const lastRoll = useDecisionStore((s) => s.lastRoll);
  const phase = useDecisionStore((s) => s.phase);
  const setMode = useDecisionStore((s) => s.setMode);
  const busy = phase === "dragging" || phase === "releasing" || phase.startsWith("revealing");
  const inRoll = mode !== "explore";

  return (
    <div className="modebar" role="tablist" aria-label="模式切换">
      <div className={`modebar__group${inRoll ? " is-active" : ""}`}>
        <button
          type="button"
          role="tab"
          aria-selected={inRoll}
          disabled={busy}
          className="modebar__tab"
          onClick={() => !inRoll && setMode(lastRoll)}
        >
          <span className="modebar__num">01</span> / ROLL
        </button>
        <div className="chips" role="group" aria-label="拉绳模式">
          {ROLL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              title={CHIP_TITLE[m]}
              aria-label={CHIP_TITLE[m]}
              aria-pressed={mode === m}
              disabled={busy}
              className={`chip${mode === m ? " is-active" : ""}`}
              onClick={() => mode !== m && setMode(m)}
            >
              {CHIP[m]}
              {mode === m && (
                <svg className="chip__ring" viewBox="0 0 48 48" preserveAspectRatio="none" aria-hidden>
                  <path d="M9 26 C 5 10, 30 3, 40 14 C 48 24, 36 44, 20 43 C 6 41, 3 22, 17 9" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        role="tab"
        aria-selected={!inRoll}
        disabled={busy}
        className={`modebar__tab${!inRoll ? " is-active" : ""}`}
        onClick={() => inRoll && setMode("explore")}
      >
        <span className="modebar__num">02</span> / MAP ↗
      </button>
    </div>
  );
}
