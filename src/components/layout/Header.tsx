"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MODE_COPY } from "@/data/copy";
import { SKINS, SKIN_ORDER } from "@/data/skins";
import { useDecisionStore } from "@/stores/decision-store";
import { useSkinStore } from "@/stores/skin-store";

export function Header() {
  const mode = useDecisionStore((s) => s.mode);
  const history = useDecisionStore((s) => s.history);
  const clear = useDecisionStore((s) => s.clearHistory);
  const skin = useSkinStore((s) => s.skin);
  const setSkin = useSkinStore((s) => s.setSkin);
  const [panel, setPanel] = useState<"history" | "about" | "skin" | null>(null);
  const toggle = (p: "history" | "about" | "skin") => setPanel((cur) => (cur === p ? null : p));

  return (
    <header className="header">
      <div className="brand">
        <span className="brand__name">{MODE_COPY[mode].brand}</span>
        <span className="brand__tag">A RANDOM LIFE MACHINE · VOL.01</span>
      </div>
      <nav className="nav" aria-label="次要导航">
        <button type="button" className="nav__btn" aria-expanded={panel === "skin"} onClick={() => toggle("skin")}>
          皮肤
        </button>
        <button type="button" className="nav__btn" aria-expanded={panel === "history"} onClick={() => toggle("history")}>
          历史
        </button>
        <button type="button" className="nav__btn" aria-expanded={panel === "about"} onClick={() => toggle("about")}>
          关于
        </button>
      </nav>

      <AnimatePresence>
        {panel && (
          <motion.div
            className="popover"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {panel === "skin" ? (
              <>
                <div className="popover__head">
                  <strong>换一身皮肤</strong>
                </div>
                <ul className="skins">
                  {SKIN_ORDER.map((id) => (
                    <li key={id}>
                      <button type="button" className="skin-opt" aria-pressed={skin === id} onClick={() => setSkin(id)}>
                        <span className="skin-opt__sw" aria-hidden>
                          {SKINS[id].swatch.map((c) => (
                            <i key={c} style={{ background: c }} />
                          ))}
                        </span>
                        <span>
                          <span className="skin-opt__name">{SKINS[id].name}</span>
                          <span className="skin-opt__blurb">{SKINS[id].blurb}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : panel === "history" ? (
              <>
                <div className="popover__head">
                  <strong>最近的天意</strong>
                  {history.length > 0 && (
                    <button type="button" className="link" onClick={clear}>
                      清空
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="popover__empty">还没拉过。去拉一下吧。</p>
                ) : (
                  <ul className="history">
                    {history.slice(0, 10).map((h) => (
                      <li key={h.at}>
                        <span className="history__main">
                          {h.category}
                          {h.place ? ` · ${h.place}` : ""}
                        </span>
                        <span className="history__time">
                          {new Date(h.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div className="popover__head">
                  <strong>关于</strong>
                </div>
                <p className="popover__text">
                  一个替你做决定的拉绳玩具。拉一下抽类别，再拉一下抽具体去处。目前商家为示例数据，接入地图服务后会替换为真实地点。
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
