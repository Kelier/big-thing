import { create } from "zustand";
import { DEFAULT_SKIN, isSkinId, SKIN_STORAGE_KEY, type SkinId } from "@/data/skins";

type SkinState = {
  skin: SkinId;
  setSkin: (id: SkinId) => void;
  /** 挂载后从 localStorage 恢复（服务端渲染时始终是默认皮肤，避免水合不一致） */
  restore: () => void;
};

const apply = (id: SkinId) => {
  document.documentElement.dataset.skin = id;
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, id);
  } catch {
    /* 隐私模式下写不进去就算了 */
  }
};

export const useSkinStore = create<SkinState>((set) => ({
  skin: DEFAULT_SKIN,
  setSkin: (id) => {
    apply(id);
    set({ skin: id });
  },
  restore: () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SKIN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const id = isSkinId(saved) ? saved : DEFAULT_SKIN;
    document.documentElement.dataset.skin = id;
    set({ skin: id });
  },
}));
