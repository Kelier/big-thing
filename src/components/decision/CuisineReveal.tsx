"use client";

import { useEffect, useState } from "react";

/** 快速滚动 → 减速 → 锁定。只动一小块文字，不触发全局重渲染。 */
export function CuisineReveal({
  names,
  finalName,
  reducedMotion,
  onDone,
}: {
  names: string[];
  finalName: string;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(finalName);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      setShown(finalName);
      setLocked(true);
      const t = setTimeout(onDone, 150);
      return () => clearTimeout(t);
    }
    let alive = true;
    let delay = 50;
    let i = Math.floor(Math.random() * names.length);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      if (delay > 290) {
        setShown(finalName);
        setLocked(true);
        timer = setTimeout(() => alive && onDone(), 380);
        return;
      }
      i = (i + 1) % names.length;
      setShown(names[i]);
      delay *= 1.22;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // 仅在挂载时启动一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`reveal-name${locked ? " is-locked" : " is-rolling"}`} aria-live="polite">
      {shown}
    </div>
  );
}
