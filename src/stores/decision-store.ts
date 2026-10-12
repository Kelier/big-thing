import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isRollMode, type AppMode, type RollMode } from "@/data/cuisine-categories";
import { pickCategory, pickPlace, type SortMode } from "@/services/random-picker";
import { getLocation, loadPlaces, poi, DEFAULT_LOC, type Loc, type PlacesResult } from "@/services/poi-provider";

export type Phase =
  | "idle"
  | "dragging"
  | "releasing"
  | "revealingCuisine"
  | "cuisineSelected"
  | "revealingRestaurant"
  | "restaurantSelected";

type SettledPhase = "idle" | "cuisineSelected" | "restaurantSelected";

export type HistoryEntry = {
  at: number;
  mode: AppMode;
  category: string;
  place?: string;
};

type DecisionState = {
  mode: AppMode;
  /** 最近一次的拉绳子模式：从地图模式切回来时用 */
  lastRoll: RollMode;
  /** 用户位置（地图模式用来居中）；approx 表示用的是默认城市 */
  userLoc: Loc | null;
  /** “搜这一带”进行中 */
  searching: boolean;
  phase: Phase;
  /** 开始拖拽前所处的稳定阶段，松手后据此决定抽什么 */
  returnPhase: SettledPhase;
  categoryId: string | null;
  placeId: string | null;
  sortMode: SortMode;
  /** 越过触发阈值（仅边沿变化时更新，不随帧更新） */
  armed: boolean;
  /** 各分类的候选地点（来自高德 / OSM / 示例），键为 `${mode}:${categoryId}` */
  placesByKey: Record<string, PlacesResult>;
  /** 递增即请求一次“代拉”，供按钮 / 无障碍 / 点按使用 */
  pullNonce: number;
  history: HistoryEntry[];

  setMode: (mode: AppMode) => void;
  /** 取定位并写入 userLoc；拿不到则用默认城市（approx） */
  locate: () => Promise<Loc>;
  /** 地图上点选某个地点 */
  selectPlace: (id: string) => void;
  /** 以地图当前中心重新搜当前分类 */
  searchHere: (lat: number, lng: number) => Promise<void>;
  setSortMode: (sort: SortMode) => void;
  setArmed: (armed: boolean) => void;
  requestPull: () => void;
  beginDrag: () => boolean;
  endDrag: (triggered: boolean) => void;
  startReveal: () => void;
  prefetchPlaces: () => Promise<PlacesResult | undefined>;
  finishReveal: () => void;
  resetCategory: () => void;
  clearHistory: () => void;
};

const inflight: Record<string, Promise<PlacesResult> | undefined> = {};

const SETTLED: Phase[] = ["idle", "cuisineSelected", "restaurantSelected"];
export const canPull = (p: Phase) => SETTLED.includes(p);

export const useDecisionStore = create<DecisionState>()(
  persist(
    (set, get) => ({
      mode: "eat",
      lastRoll: "eat",
      userLoc: null,
      searching: false,
      phase: "idle",
      returnPhase: "idle",
      categoryId: null,
      placeId: null,
      sortMode: "distance",
      armed: false,
      pullNonce: 0,
      placesByKey: {},
      history: [],

      setMode: (mode) =>
        set((s) => ({
          mode,
          lastRoll: isRollMode(mode) ? mode : s.lastRoll,
          phase: "idle",
          returnPhase: "idle",
          categoryId: null,
          placeId: null,
          armed: false,
        })),

      locate: async () => {
        const got = await getLocation();
        const loc: Loc = got ?? DEFAULT_LOC;
        set({ userLoc: loc });
        return loc;
      },

      selectPlace: (id) => {
        const s = get();
        if (s.phase !== "cuisineSelected" && s.phase !== "restaurantSelected") return;
        const cat = s.categoryId ? poi.findCategory(s.mode, s.categoryId) : undefined;
        const place = cat ? s.placesByKey[`${s.mode}:${cat.id}`]?.places.find((p) => p.id === id) : undefined;
        if (!cat || !place || s.placeId === id) return;
        set({
          phase: "restaurantSelected",
          placeId: id,
          history: [{ at: Date.now(), mode: s.mode, category: cat.name, place: place.name }, ...s.history].slice(0, 30),
        });
      },

      searchHere: async (lat, lng) => {
        const s = get();
        const cat = s.categoryId ? poi.findCategory(s.mode, s.categoryId) : undefined;
        if (!cat || s.searching) return;
        const key = `${s.mode}:${cat.id}`;
        set({ searching: true });
        const r = await loadPlaces(s.mode, cat, { lat, lng });
        set((cur) => ({
          searching: false,
          placesByKey: { ...cur.placesByKey, [key]: r },
          // 结果换了一批，之前选中的地点已不在列表里
          placeId: null,
          phase: cur.phase === "restaurantSelected" ? "cuisineSelected" : cur.phase,
        }));
      },

      setSortMode: (sortMode) => set({ sortMode }),
      setArmed: (armed) => set({ armed }),
      requestPull: () => set((s) => (canPull(s.phase) ? { pullNonce: s.pullNonce + 1 } : s)),

      beginDrag: () => {
        const s = get();
        if (!canPull(s.phase)) return false;
        set({ phase: "dragging", returnPhase: s.phase as SettledPhase, armed: false });
        return true;
      },

      endDrag: (triggered) => {
        const s = get();
        if (s.phase !== "dragging") return;
        set(triggered ? { phase: "releasing", armed: false } : { phase: s.returnPhase, armed: false });
      },

      startReveal: () => {
        const s = get();
        if (s.phase !== "releasing") return;
        if (s.returnPhase === "idle") {
          const recent = s.history.filter((h) => h.mode === s.mode).slice(0, 2).map((h) => h.category);
          const pool = poi.getCategories(s.mode);
          const recentIds = pool.filter((c) => recent.includes(c.name)).map((c) => c.id);
          const cat = pickCategory(pool, recentIds);
          set({ phase: "revealingCuisine", categoryId: cat.id, placeId: null });
        } else {
          const cat = s.categoryId ? poi.findCategory(s.mode, s.categoryId) : undefined;
          if (!cat) return set({ phase: "idle", returnPhase: "idle" });
          const key = `${s.mode}:${cat.id}`;
          const pickFrom = (r: PlacesResult) => {
            const cur = get();
            const recent = cur.history.filter((h) => h.place).slice(0, 4).map((h) => h.place);
            const avoid = r.places.filter((p) => p.id === cur.placeId || recent.includes(p.name)).map((p) => p.id);
            return pickPlace(r.places, cur.sortMode, avoid).id;
          };
          const ready = s.placesByKey[key];
          if (ready) {
            set({ phase: "revealingRestaurant", placeId: pickFrom(ready) });
          } else {
            // 数据还在路上：先进入“翻找中”，到了再抽
            set({ phase: "revealingRestaurant", placeId: null });
            void get()
              .prefetchPlaces()
              .then((r) => {
                if (r && get().phase === "revealingRestaurant" && get().placeId === null) set({ placeId: pickFrom(r) });
              });
          }
        }
      },

      prefetchPlaces: async () => {
        const s = get();
        const cat = s.categoryId ? poi.findCategory(s.mode, s.categoryId) : undefined;
        if (!cat) return undefined;
        const key = `${s.mode}:${cat.id}`;
        if (s.placesByKey[key]) return s.placesByKey[key];
        if (inflight[key]) return inflight[key];
        inflight[key] = loadPlaces(s.mode, cat).then((r) => {
          set((cur) => ({ placesByKey: { ...cur.placesByKey, [key]: r } }));
          delete inflight[key];
          return r;
        });
        return inflight[key];
      },

      finishReveal: () => {
        const s = get();
        const cat = s.categoryId ? poi.findCategory(s.mode, s.categoryId) : undefined;
        if (!cat) return;
        if (s.phase === "revealingCuisine") {
          set({
            phase: "cuisineSelected",
            history: [{ at: Date.now(), mode: s.mode, category: cat.name }, ...s.history].slice(0, 30),
          });
          // 菜系揭晓后立刻在后台取附近地点（此时才会弹定位授权），等用户再拉时已经备好
          void get().prefetchPlaces();
        } else if (s.phase === "revealingRestaurant") {
          const place = s.placesByKey[`${s.mode}:${cat.id}`]?.places.find((p) => p.id === s.placeId);
          set({
            phase: "restaurantSelected",
            history: [
              { at: Date.now(), mode: s.mode, category: cat.name, place: place?.name },
              ...s.history,
            ].slice(0, 30),
          });
        }
      },

      resetCategory: () =>
        set({ phase: "idle", returnPhase: "idle", categoryId: null, placeId: null, armed: false }),

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "what-to-eat:v1",
      partialize: (s) => ({ history: s.history, sortMode: s.sortMode }),
    },
  ),
);
