"use client";

import { motion } from "motion/react";
import type { AppMode, Category, Place } from "@/data/cuisine-categories";
import { MODE_COPY } from "@/data/copy";
import { formatDistance } from "@/lib/hooks";
import { fallbackNavUrl } from "@/services/poi-provider";

export function RestaurantCard({
  place,
  category,
  mode,
  armed,
  note,
  onAgain,
}: {
  place: Place;
  category: Category;
  mode: AppMode;
  armed: boolean;
  note: string;
  onAgain: () => void;
}) {
  return (
    <motion.article
      className="card"
      initial={{ opacity: 0, y: 28, rotate: 0 }}
      animate={{ opacity: 1, y: 0, rotate: -1.2 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="tape" aria-hidden />
      <span className="card__frame" aria-hidden />
      <p className="card__area">{place.area}</p>
      <h2 className="card__name">{place.name}</h2>
      {place.signature && <p className="card__sig">{place.signature}</p>}
      <dl className="card__meta">
        <div>
          <dt>距离</dt>
          <dd>{formatDistance(place.distanceM)}</dd>
        </div>
        {place.price !== null && mode !== "toilet" && (
          <div>
            <dt>{MODE_COPY[mode].priceLabel}</dt>
            <dd>{place.price === 0 ? "免费" : `¥${place.price}`}</dd>
          </div>
        )}
      </dl>
      <div className="card__actions">
        <a
          className="btn btn--primary"
          href={place.navUrl ?? fallbackNavUrl(category)}
          target="_blank"
          rel="noreferrer"
        >
          {place.navUrl ? "导航过去" : "去地图找"} <span className="btn__arrow" aria-hidden>↗</span>
        </a>
        <button type="button" className="btn btn--ghost" onClick={onAgain}>
          {armed ? "松手！" : "换一家"}
        </button>
      </div>
      <p className="card__note">{note}</p>
    </motion.article>
  );
}
