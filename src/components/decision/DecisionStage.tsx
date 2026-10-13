"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MODE_COPY, PULL_HINTS } from "@/data/copy";
import { useDecisionStore } from "@/stores/decision-store";
import { poi, sourceLabel } from "@/services/poi-provider";
import { CuisineReveal } from "./CuisineReveal";
import { RestaurantCard } from "./RestaurantCard";

/** 红铅笔的波浪下划线，出现时像被画上去 */
function Scribble() {
  return (
    <svg className="scribble" viewBox="0 0 260 24" preserveAspectRatio="none" aria-hidden>
      <path pathLength={1} d="M4 14 C 40 4, 78 20, 124 11 S 206 6, 256 15" />
      <path pathLength={1} d="M10 20 C 60 12, 120 22, 170 16 S 230 14, 250 19" />
    </svg>
  );
}

export function DecisionStage({ reducedMotion }: { reducedMotion: boolean }) {
  const mode = useDecisionStore((s) => s.mode);
  const phase = useDecisionStore((s) => s.phase);
  const returnPhase = useDecisionStore((s) => s.returnPhase);
  const armed = useDecisionStore((s) => s.armed);
  const categoryId = useDecisionStore((s) => s.categoryId);
  const placeId = useDecisionStore((s) => s.placeId);
  const sortMode = useDecisionStore((s) => s.sortMode);
  const setSortMode = useDecisionStore((s) => s.setSortMode);
  const requestPull = useDecisionStore((s) => s.requestPull);
  const resetCategory = useDecisionStore((s) => s.resetCategory);
  const startReveal = useDecisionStore((s) => s.startReveal);
  const finishReveal = useDecisionStore((s) => s.finishReveal);

  const copy = MODE_COPY[mode];
  const category = categoryId ? poi.findCategory(mode, categoryId) : undefined;
  const placesResult = useDecisionStore((s) => (category ? s.placesByKey[`${s.mode}:${category.id}`] : undefined));
  const place = placeId ? placesResult?.places.find((p) => p.id === placeId) : undefined;
  const names = useMemo(() => poi.getCategories(mode).map((c) => c.name), [mode]);

  // 释放 → 揭晓：短暂停顿让回弹先被看见
  useEffect(() => {
    if (phase !== "releasing") return;
    const t = setTimeout(startReveal, reducedMotion ? 0 : 320);
    return () => clearTimeout(t);
  }, [phase, startReveal, reducedMotion]);

  // 商家揭晓：先“翻找”一下，再展开卡片
  useEffect(() => {
    if (phase !== "revealingRestaurant" || !placeId) return; // 真实数据还没回来就一直“翻找”
    const t = setTimeout(finishReveal, reducedMotion ? 0 : 900);
    return () => clearTimeout(t);
  }, [phase, placeId, finishReveal, reducedMotion]);

  // 背景随菜系轻微变色
  useEffect(() => {
    const root = document.documentElement;
    const show = category && phase !== "idle" && phase !== "dragging" && phase !== "releasing";
    root.style.setProperty("--tint", show ? category.tint : "transparent");
    return () => void root.style.removeProperty("--tint");
  }, [category, phase]);

  // 按住拖动 / 刚松手的那段时间，内容保持上一个稳定阶段的样子：
  // 否则按下瞬间卡片被卸载、文字块整体掉到底部，是一次大重排，正好撞在手指刚按下去的那一帧
  const stable = phase === "dragging" || phase === "releasing" ? returnPhase : phase;
  const showIntro = !category || phase === "dragging" || phase === "releasing";
  const draggingFromResult = (phase === "dragging" || phase === "releasing") && !!category;

  return (
    <section className={`copy${mode === "explore" ? " copy--map" : ""}`} aria-label="决定区域">
      <div className="copy__body">
      <AnimatePresence mode="wait">
        {showIntro && !draggingFromResult ? (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
          >
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 className="title">
              <span className="title__line">{copy.titleTop}</span>
              <span className="title__line">
                <span className="circled">
                  {copy.titleBottom}
                  <svg className="circled__ring" viewBox="0 0 240 170" preserveAspectRatio="none" aria-hidden>
                    <path
                      pathLength={1}
                      d="M42 92 C 28 40, 110 10, 178 28 C 232 44, 228 128, 140 150 C 62 168, 10 122, 34 66 C 50 30, 104 16, 150 20"
                    />
                  </svg>
                </span>
              </span>
            </h1>
            <p className="sub">{copy.sub}</p>
            <p className="sr-only" aria-live="polite">{armed ? PULL_HINTS.armed : PULL_HINTS.idle}</p>
            <button type="button" className="btn btn--primary" onClick={requestPull} disabled={phase !== "idle"}>
              {copy.cta}
              <span className="btn__arrow" aria-hidden>↓</span>
            </button>
            <p className="fine">不满意，可以反悔。没人怪你。</p>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className="result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="eyebrow">{category?.en} · TODAY&apos;S VERDICT</p>
            {category && phase === "revealingCuisine" ? (
              <CuisineReveal
                key={category.id}
                names={names}
                finalName={category.name}
                reducedMotion={reducedMotion}
                onDone={finishReveal}
              />
            ) : (
              <div className="reveal-name is-locked">{category?.name}<Scribble /></div>
            )}

            {phase !== "revealingCuisine" && category && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <p className="verdict">{copy.verdict(category.name)}</p>
                <p className="quip">{category.quip}</p>

                <div className="controls">
                  <div className="seg" role="group" aria-label="排序偏好">
                    {(
                      [
                        ["distance", "距离优先"],
                        ["price", "价格优先"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={`seg__item${sortMode === k ? " is-active" : ""}`}
                        aria-pressed={sortMode === k}
                        onClick={() => setSortMode(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="link" onClick={resetCategory}>
                    换{copy.categoryNoun}
                  </button>
                </div>

                {stable === "cuisineSelected" && (
                  <div className="again">
                    <p className="sr-only" aria-live="polite">{armed ? PULL_HINTS.armed : PULL_HINTS.retry}</p>
                    <button type="button" className="btn btn--primary" onClick={requestPull}>
                      再拉一次，抽一家
                      <span className="btn__arrow" aria-hidden>↓</span>
                    </button>
                    <p className="fine">都给你选好了，还不出门？</p>
                  </div>
                )}

                {phase === "revealingRestaurant" && (
                  <div className="card card--loading" aria-live="polite">
                    正在翻找{copy.placeLabel}<span className="dots" />
                  </div>
                )}

                {stable === "restaurantSelected" && place && (
                  <RestaurantCard
                    place={place}
                    category={category}
                    mode={mode}
                    note={sourceLabel(placesResult)}
                    armed={armed}
                    onAgain={requestPull}
                  />
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </section>
  );
}
