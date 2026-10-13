/**
 * 铅笔拉绳引擎：物理（弹簧阻尼 + Verlet 绳段）+ WebGL 渲染（外观预烘焙成贴图，每帧只贴图）。
 * 高频状态全部留在这个类里，不进 React。
 *
 * 物理在“世界单位”下计算（视口高度固定为 VH），渲染时再乘 u 转成像素。
 */

import { SKINS, type HandleKind, type Skin } from "@/data/skins";
import { GLRenderer } from "./gl-renderer";

export const NODE_COUNT = 18;
const VH = 5.36;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** 确定性伪随机：同一个 seed 永远得到同一个值，笔触才不会闪烁。 */
const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export type CordCallbacks = {
  canStart: () => boolean;
  onStart: () => void;
  onRelease: (triggered: boolean) => void;
  onArmed: (armed: boolean) => void;
};

export type CordOptions = {
  reducedMotion: boolean;
  /** 已抽出结果：窄屏下绳子缩短，给文案让位 */
  hasResult: boolean;
  /** 视口是否窄屏（手机）：canvas 现在只是一条窄带，不能再用它的宽度判断 */
  narrow: boolean;
  /** 挂点在 canvas 宽度上的位置 0~1：手机居中 0.5，桌面 0.7 */
  anchor: number;
  /** 叠在地图上：绳子和握把后面垫一层纸色光晕，免得被地图线条干扰 */
  onMap: boolean;
};

type Stroke = { x: number; y: number; dx: number; dy: number; a: number; w: number; dark: boolean };

// 握把轮廓。t∈[0,1]，side=±1 为右/左边，返回半宽（世界单位）。左右可以不对称，煎蛋的边才像手摊的
const smooth = (x: number) => {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};
const HANDLE_R: Record<HandleKind, (t: number, side: number) => number> = {
  // 煎蛋：圆润的不规则蛋白，边缘一圈起伏
  fried: (t, side) =>
    0.245 *
    Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.55) *
    (1 + 0.075 * Math.sin(9 * Math.PI * t + (side > 0 ? 0.6 : 2.4)) + 0.05 * Math.sin(5 * Math.PI * t + (side > 0 ? 0 : 1.7))),
  // 矿泉水瓶：瓶盖 → 细颈 → 肩 → 直身 → 微收的瓶底
  bottle: (t) => {
    if (t < 0.09) return 0.058;
    if (t < 0.2) return 0.04;
    if (t < 0.34) return 0.04 + 0.11 * smooth((t - 0.2) / 0.14);
    if (t < 0.95) return 0.15;
    return 0.15 - 0.03 * ((t - 0.95) / 0.05) ** 2;
  },
  // 便便：三层螺旋，取三个椭圆的外包络，层与层之间自然有凹口
  poop: (t) => {
    const lobes = [
      [0.17, 0.17, 0.08],
      [0.43, 0.2, 0.155],
      [0.77, 0.26, 0.24],
    ] as const;
    let r = 0.012 + 0.02 * smooth(t / 0.06); // 顶端的小尖
    if (t > 0.08) r = 0;
    for (const [c, h, R] of lobes) {
      const d = (t - c) / h;
      if (Math.abs(d) < 1) r = Math.max(r, R * Math.sqrt(1 - d * d));
    }
    return r;
  },
  // 枕头：圆角矩形，四角微微鼓起
  pillow: (t) => 0.3 * Math.pow(Math.max(0, 1 - Math.abs(2 * t - 1) ** 3.2), 0.38),
  // 指南针：正圆
  compass: (t) => 0.23 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)),
};
/** 握把的高度（世界单位）：枕头扁一点，水瓶高一点 */
const BODY_H_BY: Record<HandleKind, number> = { fried: 0.62, bottle: 0.8, poop: 0.7, pillow: 0.5, compass: 0.46 };
/** 握把的最大半宽，用来算在窄条 canvas 里最多能晃多远 */
const HALF_BY: Record<HandleKind, number> = { fried: 0.25, bottle: 0.15, poop: 0.24, pillow: 0.3, compass: 0.23 };
/** 命中区中心在握把上的相对位置 */
const HIT_T: Record<HandleKind, number> = { fried: 0.5, bottle: 0.5, poop: 0.62, pillow: 0.5, compass: 0.5 };
/** 高光位置（相对握把）：t 与水平偏移 */
const HL: Record<HandleKind, { t: number; x: number; rx: number; ry: number }> = {
  fried: { t: 0.28, x: -0.12, rx: 0.045, ry: 0.06 },
  bottle: { t: 0.55, x: -0.1, rx: 0.016, ry: 0.15 },
  poop: { t: 0.74, x: -0.13, rx: 0.03, ry: 0.07 },
  pillow: { t: 0.26, x: -0.17, rx: 0.045, ry: 0.05 },
  compass: { t: 0.3, x: -0.11, rx: 0.04, ry: 0.04 },
};
/** 底色铺得多实：蛋白/便便是实心的，水瓶是半透明的 */
const BASE_ALPHA: Record<HandleKind, number> = { fried: 0.96, bottle: 0.8, poop: 0.95, pillow: 0.96, compass: 0.98 };
/** 排线笔触数量 */
const STROKES: Record<HandleKind, number> = { fried: 300, bottle: 90, poop: 480, pillow: 260, compass: 40 };
const BODY_Y0 = 0.13;
const FERRULE_H = 0.15;

/** 静止时握把中心的位置：DOM 批注据此定位，不用在 canvas 里画字。H = 视口高度（像素）。 */
export function cordLayout(H: number, narrow: boolean, hasResult: boolean, kind: HandleKind) {
  const u = H / VH;
  const rest = VH * (narrow ? (hasResult ? 0.16 : 0.3) : 0.44);
  return { u, hy: (rest - 0.05 + BODY_Y0 + BODY_H_BY[kind] * HIT_T[kind]) * u, half: HALF_BY[kind] * u };
}

/** 真机性能统计：?perf 面板开启后，每帧累计引擎（物理 + 绘制）耗时。 */
export const cordPerf = { on: false, n: 0, sum: 0, max: 0, renderer: "2D" };

export class CordEngine {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private u = 1;
  private vw = 1;
  /** 视口高度（像素）：单位 u 由它决定，canvas 本身可以比视口矮（只盖住绳子活动的范围） */
  private vh = 1;
  private raf = 0;
  private lastT = 0;
  /** 静止时休眠：不再逐帧重画，摆动交给 CSS 合成层（零主线程成本） */
  private asleep = false;
  private calm = 0;
  private freeze = false;
  private motion = 0;
  private nudgeTimer = 0;
  /** WebGL 渲染器；极端情况下不支持 WebGL 时为 null（拉绳不显示，按钮仍可用） */
  private gl: GLRenderer | null = null;
  /** GL 用的预烘焙贴图（按皮肤/尺寸重建） */
  private ropeTiles: HTMLCanvasElement[] | null = null;
  private ropeTileW = 0; // 纹理的 css 宽
  private ropeTileL = 0; // 纹理一个周期的 css 长
  private canopySprite: HTMLCanvasElement | null = null;
  private haloSprite: HTMLCanvasElement | null = null;
  private burstSprites: Array<HTMLCanvasElement | null> = [null, null, null];
  private verts = new Float32Array(4 * 2 * 100);
  /** 烘焙可平铺绳子纹理时：花纹周期必须整除纹理长度 */
  private tileLen = 0;
  private jmod = 0;
  private pts: Array<{ x: number; y: number; nx: number; ny: number; tx: number; ty: number; s: number }> = [];

  private skin: Skin = SKINS.egg;
  private BH = BODY_H_BY[SKINS.egg.cord.handle.kind];
  private paperRgb = "246,241,232";
  /** 握把贴图缓存：每帧只 drawImage 一次，不再重画几百笔排线。键 = 沸腾变体 × 2 + 是否蓄力 */
  private sprites = new Map<number, HTMLCanvasElement>();
  private shadowSprite: HTMLCanvasElement | null = null;
  private cfg = { anchorX: 0, anchorY: 0, restLength: 0, maxPull: 0, threshold: 0, narrow: false };
  private opts: CordOptions = { reducedMotion: false, hasResult: false, narrow: true, anchor: 0.5, onMap: false };

  // ---- 运行时物理状态 ----
  private p = new Float32Array(NODE_COUNT * 2);
  private q = new Float32Array(NODE_COUNT * 2);
  private restKey = "";
  private rest = 0;
  private pull = 0;
  private pullV = 0;
  private hx = 0;
  private hxV = 0;
  private angle = 0;
  private angleV = 0;
  private dragging = false;
  private hover = false;
  private armed = false;
  private dragPull = 0;
  private dragX = 0;
  private auto: { t: number } | null = null;
  private impact = 0;

  // ---- 预生成的手绘素材（按像素尺寸，resize 时重建）----
  private bodyStrokes: Stroke[] = [];
  private bodyPath: Array<[number, number]> = [];
  private outlines: Array<Array<Array<[number, number]>>> = [];
  private grain: HTMLCanvasElement | null = null;
  private cleanup: Array<() => void> = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: CordCallbacks,
  ) {
    // 渲染只走 WebGL：每帧只贴预烘焙的贴图。主 canvas 归 WebGL 独占，
    // 烘焙贴图用的 Canvas 2D 画在离屏画布上（this.ctx 是离屏上下文）。
    // 极端情况下不支持 WebGL 时 gl 为 null：拉绳不显示，但“开始决定”按钮仍可用。
    this.gl = GLRenderer.create(canvas);
    cordPerf.renderer = this.gl ? "WebGL" : "无 WebGL";
    this.ctx = document.createElement("canvas").getContext("2d")!;
    this.gl?.setOnRestore(() => {
      this.dropSprites();
      this.wake();
    });
    this.makeGrain();
    this.bindPointer();
    const nudged = () => {
      this.canvas.classList.remove("is-nudge");
      if (this.asleep) this.scheduleNudge();
    };
    canvas.addEventListener("animationend", nudged);
    this.cleanup.push(() => canvas.removeEventListener("animationend", nudged));
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.gl?.dispose();
    window.clearTimeout(this.nudgeTimer);
    this.cleanup.forEach((f) => f());
    this.canvas.style.cursor = "";
  }

  setOptions(o: Partial<CordOptions>) {
    this.opts = { ...this.opts, ...o };
    this.computeCfg();
    this.wake();
  }

  resize(W: number, H: number, dpr: number, vh: number) {
    // 手机地址栏伸缩会频繁触发 resize；尺寸没变就别动，重设 canvas.width 会重新分配整块位图
    // GL 填充几乎免费，上限 2
    dpr = Math.min(dpr, 2);
    if (Math.abs(W - this.W) < 1 && Math.abs(H - this.H) < 1 && Math.abs(vh - this.vh) < 1 && dpr === this.dpr) return;
    this.W = W;
    this.H = H;
    this.vh = vh;
    this.dpr = dpr;
    this.gl?.resize(Math.round(W * dpr), Math.round(H * dpr));
    this.u = vh / VH;
    this.vw = W / this.u;
    this.computeCfg();
    this.buildHandle();
    this.wake();
  }

  private get ink() {
    return this.skin.cord.ink;
  }

  setSkin(skin: Skin) {
    if (this.skin === skin) return;
    this.skin = skin;
    const hex = skin.map.paper.replace("#", "");
    this.paperRgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
    this.BH = BODY_H_BY[skin.cord.handle.kind];
    if (this.u > 1) this.buildHandle();
    this.wake();
  }

  /** 代拉：按钮、点按、减少动效用户都走这里。 */
  autoPull() {
    if (this.dragging || this.auto || !this.cb.canStart()) return;
    this.cb.onStart();
    this.auto = { t: 0 };
    this.wake();
  }

  /** 握把左右最多能拖多远：一直到最近的 canvas 边缘（手机上就是屏幕边缘），不再被裁掉 */
  private maxX() {
    const half = HALF_BY[this.skin.cord.handle.kind] + (this.opts.onMap ? 0.09 : this.opts.narrow ? 0.07 : 0.17);
    const ax = this.W / 2 + this.cfg.anchorX * this.u;
    const edge = Math.min(ax, this.W - ax);
    return clamp((edge - half * this.u - 4) / this.u, 0, 1.3);
  }

  private computeCfg() {
    const narrow = this.opts.narrow;
    const restLength = VH * (narrow ? (this.opts.hasResult ? 0.16 : 0.3) : 0.44);
    const maxPull = VH * (narrow ? 0.17 : 0.2);
    this.cfg = {
      narrow,
      anchorX: (this.opts.anchor - 0.5) * this.vw,
      anchorY: VH / 2 + 0.05,
      restLength,
      maxPull,
      threshold: maxPull * 0.5,
    };
  }

  // 世界 → 像素
  private px(x: number) {
    return this.W / 2 + x * this.u;
  }
  private py(y: number) {
    return this.vh / 2 - y * this.u;
  }

  // ======================= 输入 =======================
  private handleCenter() {
    const o = (NODE_COUNT - 1) * 2;
    const ex = this.px(this.p[o]);
    const ey = this.py(this.p[o + 1]);
    // 握把沿局部 +y 延伸，整体旋转 -angle（canvas 的 y 向下）
    const len = (BODY_Y0 + this.BH * HIT_T[this.skin.cord.handle.kind]) * this.u;
    return { x: ex + Math.sin(this.angle) * len, y: ey + Math.cos(this.angle) * len, ex, ey };
  }

  private hit(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const c = this.handleCenter();
    // 比视觉大一圈的椭圆命中区，触屏友好
    const dx = (x - c.x) / (0.46 * this.u);
    const dy = (y - c.y) / (0.62 * this.u);
    return dx * dx + dy * dy <= 1;
  }

  private bindPointer() {
    const cv = this.canvas;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let moved = 0;
    let pid = -1;

    const down = (e: PointerEvent) => {
      if (this.dragging || this.auto || !this.cb.canStart() || !this.hit(e.clientX, e.clientY)) return;
      pid = e.pointerId;
      cv.setPointerCapture(pid);
      this.cb.onStart();
      this.dragging = true;
      this.wake();
      this.dragPull = 0;
      this.dragX = 0;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      moved = 0;
      cv.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== pid) {
        const h = !this.dragging && this.hit(e.clientX, e.clientY) && this.cb.canStart();
        if (h !== this.hover) {
          this.hover = h;
          this.wake();
        }
        cv.style.cursor = h ? "grab" : "";
        return;
      }
      const wpp = 1 / this.u;
      const dx = (e.clientX - startX) * wpp;
      const dy = (e.clientY - startY) * wpp;
      moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
      const mp = this.cfg.maxPull;
      // 下拉：tanh 软上限，越拉越吃力，但不会无限延长
      this.dragPull = dy >= 0 ? mp * Math.tanh(dy / mp) : dy * 0.12;
      const mx = this.maxX();
      this.dragX = clamp(dx * 0.9, -mx, mx);
    };
    const up = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== pid) return;
      cv.releasePointerCapture?.(pid);
      cv.style.cursor = this.hover ? "grab" : "";
      const isTap = moved < 6 && performance.now() - startT < 350;
      if (isTap) {
        // 点一下也能玩：交给代拉
        this.dragging = false;
        this.dragPull = 0;
        this.dragX = 0;
        this.cb.onRelease(false);
        this.autoPull();
        return;
      }
      this.release(this.pull >= this.cfg.threshold);
    };
    const leave = () => {
      if (this.hover) this.wake();
      this.hover = false;
      if (!this.dragging) cv.style.cursor = "";
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", leave);
    this.cleanup.push(() => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerleave", leave);
    });
  }

  private setArmed(next: boolean) {
    if (this.armed === next) return;
    this.armed = next;
    this.cb.onArmed(next);
    // 页面还没被点过时浏览器会拦截震动并刷警告，等有过用户操作再震
    if (next && typeof navigator !== "undefined" && "vibrate" in navigator && navigator.userActivation?.hasBeenActive !== false) {
      try {
        navigator.vibrate(12);
      } catch {
        /* 不支持就算了 */
      }
    }
  }

  private release(triggered: boolean) {
    this.dragging = false;
    this.auto = null;
    this.setArmed(false);
    if (triggered) this.impact = 1;
    this.cb.onRelease(triggered);
  }

  // ======================= 物理 =======================
  private step(dt: number, t: number) {
    const c = this.cfg;
    const N = NODE_COUNT;
    const p = this.p;
    const q = this.q;

    const key = `${c.anchorX.toFixed(3)}|${c.anchorY.toFixed(3)}`;
    if (this.restKey !== key) {
      this.restKey = key;
      for (let i = 0; i < N; i++) {
        const y = c.anchorY - (c.restLength * i) / (N - 1);
        p[i * 2] = q[i * 2] = c.anchorX;
        p[i * 2 + 1] = q[i * 2 + 1] = y;
      }
      this.pull = this.pullV = this.hx = this.hxV = 0;
      this.rest = c.restLength;
    }
    this.rest += (c.restLength - this.rest) * Math.min(1, dt * 4);

    const reduced = this.opts.reducedMotion;
    const SUB = 2;
    const h = dt / SUB;
        for (let k = 0; k < SUB; k++) {
      let pullT = 0;
      let xT = 0;
      let kP = 110;
      let cP = 8.5; // 欠阻尼：松手有 2~3 次过冲
      let kX = 55;
      let cX = 3.2;
      if (this.dragging) {
        pullT = this.dragPull;
        xT = this.dragX;
        kP = 300;
        cP = 30;
        kX = 220;
        cX = 24;
      } else if (this.auto) {
        pullT = c.maxPull * 0.78;
        kP = 280;
        cP = 26;
      }
      this.pullV += ((pullT - this.pull) * kP - this.pullV * cP) * h;
      this.pull += this.pullV * h;
      this.hxV += ((xT - this.hx) * kX - this.hxV * cX) * h;
      this.hx += this.hxV * h;
    }

    if (this.auto) {
      this.auto.t += dt;
      if (this.pull >= c.threshold * 1.08 || this.auto.t > 0.5) this.release(true);
    }
    if (this.dragging || this.auto) this.setArmed(this.pull >= c.threshold);
    this.impact = Math.max(0, this.impact - dt * 2.4);

    // ---- 绳段：Verlet + 距离约束 ----
    const ax = c.anchorX;
    const ay = c.anchorY;
    const ex = ax + this.hx;
    const ey = ay - this.rest - this.pull;
    const dist = Math.hypot(ex - ax, ey - ay);
    // 回弹过冲时手柄高于静止点 → 绳子多出一截松弛，自然弯曲
    const len = Math.max(this.rest, dist);
    const slack = len - dist;
    const seg = len / (N - 1);

    p[0] = ax;
    p[1] = ay;
    p[(N - 1) * 2] = ex;
    p[(N - 1) * 2 + 1] = ey;

    for (let i = 1; i < N - 1; i++) {
      const o = i * 2;
      const vx = (p[o] - q[o]) * 0.985;
      const vy = (p[o + 1] - q[o + 1]) * 0.985;
      q[o] = p[o];
      q[o + 1] = p[o + 1];
      const wob = reduced ? 0 : Math.sin(t * 6 + i * 0.7) * slack * 0.9 * dt * dt * 60;
      p[o] += vx + wob;
      p[o + 1] += vy - 2.5 * dt * dt;
    }
    // 弯曲刚度：相邻节点平滑，消除折弯（真实拉绳是有一点“挺”的）
    for (let i = 1; i < N - 1; i++) {
      const o = i * 2;
      p[o] += ((p[o - 2] + p[o + 2]) * 0.5 - p[o]) * 0.28;
      p[o + 1] += ((p[o - 1] + p[o + 3]) * 0.5 - p[o + 1]) * 0.28;
    }
    for (let it = 0; it < 16; it++) {
      // 正反交替扫描，避免残差全堆在某一端
      for (let n = 0; n < N - 1; n++) {
        const i = it % 2 === 0 ? n : N - 2 - n;
        const a = i * 2;
        const b = a + 2;
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - seg) / d;
        const aFixed = i === 0;
        const bFixed = i + 1 === N - 1;
        const wa = aFixed ? 0 : bFixed ? 1 : 0.5;
        const wb = bFixed ? 0 : aFixed ? 1 : 0.5;
        p[a] += dx * diff * wa;
        p[a + 1] += dy * diff * wa;
        p[b] -= dx * diff * wb;
        p[b + 1] -= dy * diff * wb;
      }
    }

    let m = 0;
    for (let i = 1; i < N - 1; i++) m = Math.max(m, Math.abs(p[i * 2] - q[i * 2]), Math.abs(p[i * 2 + 1] - q[i * 2 + 1]));
    this.motion = m;

    // 手柄角度：取末端四段的整体方向，带弹簧延迟 → 过冲摆动
    const o = (N - 1) * 2;
    const target = clamp(Math.atan2(-(p[o - 8] - p[o]), p[o - 7] - p[o + 1]), -1.1, 1.1);
    this.angleV += ((target - this.angle) * 150 - this.angleV * 12) * dt;
    this.angle += this.angleV * dt;
  }

  // ======================= 手绘素材 =======================
  private makeGrain() {
    // 纸面颗粒：只在烘焙握把贴图时用 destination-out 蚀出纸纹。逐帧对整条绳子做这个合成，iOS 上很慢，所以绳子本身不做
    const s = 192;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d")!;
    const img = g.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const r = hash(i * 1.37 + 5.1);
      const a = r < 0.3 ? 120 + hash(i + 9.2) * 120 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    this.grain = c;
  }

  /** 握把的所有手绘素材：轮廓（3 个“沸腾”变体 × 2 遍）与排线笔触。像素尺寸，局部坐标，原点在绳端。 */
  private buildHandle() {
    const u = this.u;
    const kind = this.skin.cord.handle.kind;
    const handleR = HANDLE_R[kind];
    const STEPS = 40;
    const right: Array<[number, number]> = [];
    const left: Array<[number, number]> = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = (BODY_Y0 + this.BH * t) * u;
      right.push([Math.max(handleR(t, 1), 0.0005) * u, y]);
      left.push([-Math.max(handleR(t, -1), 0.0005) * u, y]);
    }
    this.bodyPath = [...right, ...left.reverse()];

    this.outlines = [0, 1, 2].map((variant) =>
      [0, 1].map((pass) =>
        this.bodyPath.map(([x, y], i) => {
          const amp = pass === 0 ? 1.0 : 1.6;
          return [
            x + (hash(i * 3.1 + variant * 17 + pass * 5) - 0.5) * amp,
            y + (hash(i * 5.7 + variant * 23 + pass * 11) - 0.5) * amp,
          ] as [number, number];
        }),
      ),
    );

    // 彩铅排线：随机撒点，落在轮廓内且避开左上高光
    const strokes: Stroke[] = [];
    const maxR = HALF_BY[kind] * u;
    const y0 = BODY_Y0 * u;
    const y1 = (BODY_Y0 + this.BH) * u;
    const h = HL[kind];
    const hl = { x: h.x * u, y: (BODY_Y0 + this.BH * h.t) * u, rx: h.rx * u, ry: h.ry * u };
    const want = STROKES[kind];
    for (let i = 0, n = 0; n < want && i < 6000; i++) {
      const x = (hash(i * 1.91 + 1) * 2 - 1) * maxR;
      const y = y0 + hash(i * 2.73 + 2) * (y1 - y0);
      const t = (y - y0) / (y1 - y0);
      if (Math.abs(x) > Math.max(handleR(t, x < 0 ? -1 : 1), 0.001) * u * 0.94) continue;
      const hx = (x - hl.x) / hl.rx;
      const hy = (y - hl.y) / hl.ry;
      if (hx * hx + hy * hy < 1) continue;
      const dark = x > 0.03 * u || t > 0.85;
      // 蛋白、水瓶、枕头只在背光侧排线，其余留白；便便满身排线
      if (kind !== "poop" && !dark) continue;
      const ang = dark && hash(i * 7.7) > 0.5 ? -0.8 : 0.95;
      const len = (6 + hash(i * 4.1 + 3) * 10) * (u / 160);
      strokes.push({
        x,
        y,
        dx: Math.cos(ang) * len,
        dy: Math.sin(ang) * len,
        a: 0.35 + hash(i * 6.3 + 4) * 0.5,
        w: 1 + hash(i * 8.9 + 6) * 0.9,
        dark,
      });
      n++;
    }
    this.bodyStrokes = strokes;
    this.dropSprites();
  }

  /** 丢掉所有烘焙贴图（换皮肤/改尺寸/上下文恢复）；GL 纹理一并释放 */
  private dropSprites() {
    const old: HTMLCanvasElement[] = [...this.sprites.values()];
    for (const c of [this.shadowSprite, this.canopySprite, this.haloSprite, ...this.burstSprites, ...(this.ropeTiles ?? [])]) if (c) old.push(c);
    this.gl?.forget(old);
    this.sprites.clear();
    this.shadowSprite = null;
    this.canopySprite = null;
    this.haloSprite = null;
    this.burstSprites = [null, null, null];
    this.ropeTiles = null;
  }

  /** 握把在局部坐标里占的范围（含绳扣、铃舌），原点在绳端 */
  private spriteBox() {
    const u = this.u;
    return { ox: 0.32 * u, oy: 0.04 * u, w: 0.64 * u, h: (BODY_Y0 + this.BH) * u + 0.04 * u + 0.12 * u };
  }

  /** 把 paint 画进离屏 canvas：按设备像素分辨率，局部坐标与屏幕上完全一致 */
  private bake(paint: () => void, grain = true, box?: { ox: number; oy: number; w: number; h: number }) {
    const b = box ?? this.spriteBox();
    const c = document.createElement("canvas");
    c.width = Math.ceil(b.w * this.dpr);
    c.height = Math.ceil(b.h * this.dpr);
    const g = c.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    g.translate(b.ox, b.oy);
    g.lineCap = "round";
    g.lineJoin = "round";
    const main = this.ctx;
    this.ctx = g;
    try {
      paint();
      if (grain && this.grain) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = g.createPattern(this.grain, "repeat")!;
        g.fillRect(0, 0, c.width, c.height);
      }
    } finally {
      this.ctx = main;
    }
    return c;
  }

  // ======================= 渲染 =======================
  private frame = (now: number) => {
    this.raf = 0;
    if (this.W === 0) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const dt = Math.min((now - (this.lastT || now)) / 1000, 1 / 30);
    this.lastT = now;
    const t0 = cordPerf.on ? performance.now() : 0;
    this.step(dt, now / 1000);

    // 连续几帧都静止（物理量、批注淡入淡出都收敛了）就休眠：最后画一张不抖动的静帧，
    // 之后摆动由 CSS 对整块 canvas 做 rotate，在合成层完成，主线程和光栅化都是零成本
    this.calm = this.isSettled() ? this.calm + 1 : 0;
    if (this.calm > 8) {
      this.freeze = true;
      this.drawGL(now);
      this.freeze = false;
      this.asleep = true;
      this.scheduleNudge();
      return;
    }
    this.drawGL(now);
    if (cordPerf.on) {
      const d = performance.now() - t0;
      cordPerf.n++;
      cordPerf.sum += d;
      cordPerf.max = Math.max(cordPerf.max, d);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private isSettled() {
    return (
      !this.dragging &&
      !this.auto &&
      this.impact <= 0.02 &&
      Math.abs(this.pull) < 5e-4 &&
      Math.abs(this.pullV) < 5e-3 &&
      Math.abs(this.hx) < 5e-4 &&
      Math.abs(this.hxV) < 5e-3 &&
      Math.abs(this.angleV) < 5e-3 &&
      Math.abs(this.rest - this.cfg.restLength) < 5e-4 &&
      this.motion < 1e-3
    );
  }

  /**
   * 静止时的“活气”：不是持续动画（那会让合成器永远以 60fps 空转，实测空闲 26% 的核），
   * 而是每隔几秒让 canvas 在合成层上晃一下，其余时间页面完全静止。
   */
  private scheduleNudge() {
    if (this.opts.reducedMotion) return;
    this.stopNudge();
    this.nudgeTimer = window.setTimeout(() => this.canvas.classList.add("is-nudge"), 8000 + Math.random() * 6000);
  }

  private stopNudge() {
    window.clearTimeout(this.nudgeTimer);
    this.canvas.classList.remove("is-nudge");
  }

  /** 有任何需要重画的事（拖动、悬停、换皮肤、改尺寸、批注变化……）就把引擎叫醒 */
  private wake() {
    this.calm = 0;
    if (!this.asleep) return;
    this.asleep = false;
    this.lastT = 0;
    this.stopNudge();
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  // ======================= WebGL 路径 =======================
  private static rgb(str: string): [number, number, number] {
    const [r, g, b] = str.split(",").map((v) => Number(v) / 255);
    return [r, g, b];
  }

  private static softC: HTMLCanvasElement | null = null;
  private static solidC: HTMLCanvasElement | null = null;
  /** 影子/光晕的横向柔边（中间实、两侧渐隐）与纯白实心：只取 alpha 当形状，颜色由 uniform 染 */
  private static getSoft() {
    if (!CordEngine.softC) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 4;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 32, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 4);
      CordEngine.softC = c;
    }
    return CordEngine.softC;
  }
  private static getSolid() {
    if (!CordEngine.solidC) {
      const c = document.createElement("canvas");
      c.width = c.height = 4;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 4, 4);
      CordEngine.solidC = c;
    }
    return CordEngine.solidC;
  }

  /** 绳子外观烘焙成一张可平铺的纹理（竖直方向）：二的幂尺寸，花纹周期整除长度，首尾无缝 */
  private getRopeTile(boil: number) {
    this.ropeTiles ??= [];
    const cached = this.ropeTiles[boil];
    if (cached) return cached;
    const dpr = this.dpr;
    const r = Math.max(5.6, this.u * 0.04);
    const pot = (n: number) => {
      let q = 16;
      while (q < n) q *= 2;
      return q;
    };
    const wPx = pot(Math.ceil((2 * r + 14) * dpr));
    const hPx = 256;
    const wCss = wPx / dpr;
    const L = hPx / dpr;
    this.ropeTileW = wCss;
    this.ropeTileL = L;
    const c = document.createElement("canvas");
    c.width = wPx;
    c.height = hPx;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.translate(wCss / 2, 0);
    g.lineCap = "round";
    g.lineJoin = "round";
    // 竖直向下的直绳，上下各多画一个周期，保证纹理边缘处的笔触也是完整的
    const SAMPLES = 64;
    const pts: Array<{ x: number; y: number; nx: number; ny: number; tx: number; ty: number; s: number }> = [];
    for (let j = 0; j <= SAMPLES * 3; j++) {
      const y = -L + (j / SAMPLES) * L;
      pts.push({ x: 0, y, nx: -1, ny: 0, tx: 0, ty: 1, s: L - y });
    }
    const main = this.ctx;
    this.ctx = g;
    this.tileLen = L;
    this.jmod = SAMPLES;
    try {
      this.drawRope(pts, boil);
    } finally {
      this.tileLen = 0;
      this.jmod = 0;
      this.ctx = main;
    }
    this.ropeTiles[boil] = c;
    return c;
  }

  private burstBox() {
    const u = this.u;
    return { ox: 0.5 * u, oy: 0.15 * u, w: 1.0 * u, h: (BODY_Y0 + this.BH) * u + 0.3 * u };
  }

  /** 沿路径铺一条三角带（两侧各 half）；tileL>0 时 v 随弧长走，让花纹跟着握把移动 */
  private stripVerts(pts: Array<{ x: number; y: number; nx: number; ny: number; s: number }>, half: number, dx: number, dy: number, tileL: number, taper = 0) {
    const V = this.verts;
    let o = 0;
    for (const p of pts) {
      const v = tileL ? -p.s / tileL : 0;
      // 握把一端收成圆头，模拟 Canvas 2D 描边的圆端点（影子/光晕用）
      const h = taper && p.s < taper ? half * Math.sqrt(Math.max(0, 1 - (1 - p.s / taper) ** 2)) : half;
      V[o++] = p.x + p.nx * h + dx;
      V[o++] = p.y + p.ny * h + dy;
      V[o++] = 0;
      V[o++] = v;
      V[o++] = p.x - p.nx * h + dx;
      V[o++] = p.y - p.ny * h + dy;
      V[o++] = 1;
      V[o++] = v;
    }
    return pts.length * 2;
  }

  /** 贴图四边形：先横向缩放 sx、再旋转 -angle、再平移到 (x, y)，和 Canvas 2D 的变换顺序一致 */
  private quadVerts(x: number, y: number, sx: number, box: { ox: number; oy: number; w: number; h: number }) {
    const V = this.verts;
    const rot = -this.angle;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    let o = 0;
    for (const [lx, ly, uu, vv] of [
      [-box.ox, -box.oy, 0, 0],
      [-box.ox + box.w, -box.oy, 1, 0],
      [-box.ox, -box.oy + box.h, 0, 1],
      [-box.ox + box.w, -box.oy + box.h, 1, 1],
    ] as const) {
      const X = lx * sx;
      V[o++] = x + X * cs - ly * sn;
      V[o++] = y + X * sn + ly * cs;
      V[o++] = uu;
      V[o++] = vv;
    }
    return 4;
  }

  private drawGL(now: number) {
    const gl = this.gl;
    if (!gl || gl.lost) return;
    const u = this.u;
    const boil = this.opts.reducedMotion || this.freeze ? 0 : Math.floor(now / 140) % 3;
    const N = NODE_COUNT;
    const o = (N - 1) * 2;
    const ex = this.px(this.p[o]);
    const ey = this.py(this.p[o + 1]);
    const ax = this.px(this.cfg.anchorX);
    const ay = this.py(this.cfg.anchorY);
    const pts = this.samplePath();
    const r = Math.max(5.6, u * 0.04);
    const ink = CordEngine.rgb(this.ink);
    const bx = this.spriteBox();
    const sx = this.dragging ? 1.04 : this.hover ? 1.03 : 1;

    gl.begin(this.W, this.H);

    // 地图上：纸色光晕压住地图线条
    if (this.opts.onMap) {
      const paper = this.paperRgb.split(",").map((v) => Number(v) / 255) as [number, number, number];
      gl.draw(CordEngine.getSolid(), this.verts, this.stripVerts(pts, r + 8, 0, 0, 0, r + 8), 0.6, { tint: paper });
      this.haloSprite ??= this.bake(() => {
        const c = this.ctx;
        this.bodyShape(this.bodyPath);
        c.fillStyle = "#fff";
        c.strokeStyle = "#fff";
        c.lineWidth = 16;
        c.stroke();
        c.fill();
      }, false);
      gl.draw(this.haloSprite, this.verts, this.quadVerts(ex, ey, 1, bx), 0.6, { tint: paper });
    }

    // 影子：绳影（柔边带）+ 握把影（斜线排线贴图）
    const off = u * ((this.opts.onMap ? 0.08 : this.opts.narrow ? 0.1 : 0.16) + Math.max(0, this.pull) * 0.06);
    const dx = off;
    const dy = off * 0.32;
    gl.draw(CordEngine.getSoft(), this.verts, this.stripVerts(pts, 9, dx, dy, 0, 9), 0.14, { tint: ink });
    gl.draw(this.getShadowSprite(), this.verts, this.quadVerts(ex + dx * 1.15, ey + dy * 1.15, 1, bx), 1);

    // 吊顶的小圆盘
    const cw = this.u * 0.3 * 2 + 12;
    const ch = this.u * 0.075 * 2 + 12;
    this.canopySprite ??= this.bake(() => this.drawCanopy(0, this.u * 0.03), false, { ox: cw / 2, oy: ch / 2, w: cw, h: ch });
    const cy = ay - this.u * 0.03;
    {
      const V = this.verts;
      V.set([ax - cw / 2, cy - ch / 2, 0, 0, ax + cw / 2, cy - ch / 2, 1, 0, ax - cw / 2, cy + ch / 2, 0, 1, ax + cw / 2, cy + ch / 2, 1, 1]);
      gl.draw(this.canopySprite, V, 4, 1);
    }

    // 绳子：一条三角带，贴可平铺纹理；v 随弧长走
    const tile = this.getRopeTile(boil);
    gl.draw(tile, this.verts, this.stripVerts(pts, this.ropeTileW / 2, 0, 0, this.ropeTileL), 1, { repeat: true });

    // 蓄力/松手的荧光笔涂块
    if (this.armed || this.impact > 0.02) {
      let b = this.burstSprites[boil];
      if (!b) b = this.burstSprites[boil] = this.bake(() => this.paintBurst(boil, 1), false, this.burstBox());
      const bb = this.burstBox();
      gl.draw(b, this.verts, this.quadVerts(ex, ey, 1, bb), this.armed ? 1 : this.impact);
    }

    // 握把
    gl.draw(this.getHandleSprite(boil), this.verts, this.quadVerts(ex, ey, sx, bx), 1);
  }

  /** Catmull–Rom 采样，返回像素坐标 + 法线 + 距手柄的弧长。 */
  private samplePath() {
    const N = NODE_COUNT;
    const S = 96;
    const p = this.p;
    const out = this.pts;
    if (out.length !== S + 1) {
      out.length = 0;
      for (let j = 0; j <= S; j++) out.push({ x: 0, y: 0, nx: 0, ny: 0, tx: 0, ty: 0, s: 0 });
    }
    for (let j = 0; j <= S; j++) {
      const uu = (j / S) * (N - 1);
      const i = Math.min(Math.floor(uu), N - 2);
      const f = uu - i;
      const i0 = Math.max(i - 1, 0) * 2;
      const i1 = i * 2;
      const i2 = (i + 1) * 2;
      const i3 = Math.min(i + 2, N - 1) * 2;
      const f2 = f * f;
      const f3 = f2 * f;
      const cr = (a: number) =>
        0.5 *
        (2 * p[i1 + a] +
          (-p[i0 + a] + p[i2 + a]) * f +
          (2 * p[i0 + a] - 5 * p[i1 + a] + 4 * p[i2 + a] - p[i3 + a]) * f2 +
          (-p[i0 + a] + 3 * p[i1 + a] - 3 * p[i2 + a] + p[i3 + a]) * f3);
      out[j].x = this.px(cr(0));
      out[j].y = this.py(cr(1));
    }
    for (let j = 0; j <= S; j++) {
      const a = out[Math.max(j - 1, 0)];
      const b = out[Math.min(j + 1, S)];
      const tx = b.x - a.x;
      const ty = b.y - a.y;
      const l = Math.hypot(tx, ty) || 1;
      out[j].tx = tx / l;
      out[j].ty = ty / l;
      out[j].nx = -ty / l;
      out[j].ny = tx / l;
    }
    // 弧长从手柄端起算：花纹随手柄一起走
    out[S].s = 0;
    for (let j = S - 1; j >= 0; j--) out[j].s = out[j + 1].s + Math.hypot(out[j + 1].x - out[j].x, out[j + 1].y - out[j].y);
    return out;
  }

  private polyline(
    pts: Array<{ x: number; y: number }>,
    offset: number,
    nrm: Array<{ nx: number; ny: number }>,
    jitter: number,
    seed: number,
  ) {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((pt, j) => {
      const jj = this.jmod ? j % this.jmod : j;
      const jx = (hash(jj * 1.7 + seed) - 0.5) * jitter;
      const jy = (hash(jj * 2.3 + seed + 40) - 0.5) * jitter;
      const x = pt.x + nrm[j].nx * offset + jx;
      const y = pt.y + nrm[j].ny * offset + jy;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private drawRope(pts: ReturnType<CordEngine["samplePath"]>, boil: number) {
    const ctx = this.ctx;
    const r = Math.max(5.6, this.u * 0.04);
    const { kind, a, b } = this.skin.cord.rope;

    const centerline = () => {
      ctx.beginPath();
      pts.forEach((pt, j) => (j ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    };
    /** 烘焙可平铺纹理时，把花纹周期吸附到“纹理长度的整数分之一”，并给出周期数 n（实时绘制时 n=0，不吸附） */
    const snap = (p: number, even = false): [number, number] => {
      if (!this.tileLen) return [p, 0];
      let n = Math.max(1, Math.round(this.tileLen / p));
      if (even && n % 2) n++;
      return [this.tileLen / n, n];
    };
    const per = (k: number, n: number) => (n ? ((k % n) + n) % n : k);
    /** 沿弧长精确地每隔 pitch 一个标记点（弧长从握把端起算，花纹随握把一起走） */
    const marks = (pitch: number, cb: (k: number, x: number, y: number, p: (typeof pts)[number]) => void) => {
      for (let j = 0; j < pts.length - 1; j++) {
        const p0 = pts[j];
        const p1 = pts[j + 1];
        const k0 = Math.ceil(p1.s / pitch);
        const k1 = Math.floor(p0.s / pitch);
        for (let k = k0; k <= k1; k++) {
          const f = (p0.s - k * pitch) / Math.max(p0.s - p1.s, 1e-6);
          cb(k, p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p0);
        }
      }
    };
    /** 沿弧长等距的斜向笔触：绳子的“捻股”。奇偶两种样式各合成一条路径，一次描完 */
    const twist = (P: number, style: [{ w: number; c: string }, { w: number; c: string }], lean: number, fuzz: boolean) => {
      const [pitch, n] = snap(P);
      const paths = [new Path2D(), new Path2D()];
      const hairs = new Path2D();
      marks(pitch, (k, x0, y, p0) => {
        const kk = per(k, n);
        const x = x0 + (hash(kk * 3.3) - 0.5) * 1.2;
        const L = r * (1.15 + hash(kk * 1.1) * 0.25);
        // 对角线方向 = 法线 + 切线
        const dx = p0.nx * L + p0.tx * L * lean;
        const dy = p0.ny * L + p0.ty * L * lean;
        const path = paths[k & 1];
        path.moveTo(x - dx, y - dy);
        path.lineTo(x + dx, y + dy);
        // 麻绳边缘翘出来的毛刺
        if (fuzz && hash(kk * 9.1) > 0.55) {
          const side = hash(kk * 5.5) > 0.5 ? 1 : -1;
          const bx = x + dx * side;
          const by = y + dy * side;
          hairs.moveTo(bx, by);
          hairs.lineTo(bx + p0.nx * side * 3.5 + p0.tx * 2, by + p0.ny * side * 3.5 + p0.ty * 2);
        }
      });
      for (const i of [0, 1]) {
        ctx.strokeStyle = style[i].c;
        ctx.lineWidth = style[i].w;
        ctx.stroke(paths[i]);
      }
      if (fuzz) {
        ctx.strokeStyle = `rgba(${this.ink},0.5)`;
        ctx.lineWidth = 1;
        ctx.stroke(hairs);
      }
    };

    if (kind === "chain") {
      // 黄铜链：一节立着（环），一节侧着（扁），沿弧长交替；链节自带描边，不画绳子的轮廓线
      const [pitch] = snap(r * 2.1, true);
      const ring = new Path2D();
      const edge = new Path2D();
      marks(pitch, (k, x, y, p0) => {
        const ang = Math.atan2(p0.ty, p0.tx);
        const path = k & 1 ? edge : ring;
        const ry = k & 1 ? r * 0.3 : r * 0.95;
        path.moveTo(x + Math.cos(ang) * pitch * 0.68, y + Math.sin(ang) * pitch * 0.68);
        path.ellipse(x, y, pitch * 0.68, ry, ang, 0, Math.PI * 2);
      });
      ctx.lineWidth = 5.4;
      ctx.strokeStyle = `rgba(${this.ink},0.85)`;
      ctx.stroke(ring);
      ctx.fillStyle = `rgba(${b},1)`;
      ctx.fill(edge);
      ctx.lineWidth = 1.6;
      ctx.stroke(edge);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${a},1)`;
      ctx.stroke(ring);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.stroke(ring);
      return;
    }

    if (kind === "hemp") {
      // 麻绳：焦糖底，淡黄与焦糖相间的粗股
      ctx.strokeStyle = `rgba(${b},0.95)`;
      ctx.lineWidth = r * 2;
      centerline();
      ctx.stroke();
      // k 为偶数 → 淡黄粗股，奇数 → 焦糖细股
      twist(r * 1.3, [{ w: 2.8, c: `rgba(${a},0.95)` }, { w: 1.8, c: `rgba(${b},0.9)` }], 0.85, true);
    } else if (kind === "braid") {
      // 面条绳：橙黄麻花，亮面在一侧
      ctx.strokeStyle = `rgba(${a},0.95)`;
      ctx.lineWidth = r * 2;
      centerline();
      ctx.stroke();
      twist(r * 1.7, [{ w: 3.4, c: `rgba(${b},0.95)` }, { w: 2, c: `rgba(${this.ink},0.2)` }], 0.6, false);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2.2;
      this.polyline(pts, -r * 0.5, pts, 0.5, 31);
    } else if (kind === "water") {
      // 水珠绳：浅蓝透明的绳身，白色高光斜纹，沿途冒着小气泡
      ctx.strokeStyle = `rgba(${a},0.9)`;
      ctx.lineWidth = r * 2;
      centerline();
      ctx.stroke();
      twist(r * 1.5, [{ w: 2.2, c: `rgba(${b},0.85)` }, { w: 1.4, c: `rgba(${this.ink},0.16)` }], 0.7, false);
      const bubbles = new Path2D();
      const [gap, gn] = snap(r * 3.4, true);
      marks(gap, (k, x, y, p0) => {
        const side = k & 1 ? 1 : -1;
        const bx = x + p0.nx * side * r * 0.35;
        const by = y + p0.ny * side * r * 0.35;
        const br = r * (0.22 + hash(per(k, gn) * 2.1) * 0.12);
        bubbles.moveTo(bx + br, by);
        bubbles.arc(bx, by, br, 0, Math.PI * 2);
      });
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fill(bubbles);
      ctx.strokeStyle = `rgba(${this.ink},0.45)`;
      ctx.lineWidth = 1;
      ctx.stroke(bubbles);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      this.polyline(pts, -r * 0.5, pts, 0.5, 31);
    } else {
      // 双色棉线：两股相互缠绕，用正反面遮挡做出螺旋
      const [pitch] = snap(r * 7);
      const amp = r * 0.5;
      const phase = (s: number) => (s / pitch) * Math.PI * 2;
      // 一股线 = 一条路径：只画“在前面”的那几段时，连续的段并成一笔
      const strand = (sign: number, front: boolean, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        let open = false;
        for (let j = 0; j < pts.length - 1; j++) {
          const p0 = pts[j];
          const p1 = pts[j + 1];
          if (front && sign * Math.cos(phase((p0.s + p1.s) / 2)) <= 0) {
            open = false;
            continue;
          }
          const o0 = sign * amp * Math.sin(phase(p0.s));
          const o1 = sign * amp * Math.sin(phase(p1.s));
          if (!open) {
            ctx.moveTo(p0.x + p0.nx * o0, p0.y + p0.ny * o0);
            open = true;
          }
          ctx.lineTo(p1.x + p1.nx * o1, p1.y + p1.ny * o1);
        }
        ctx.stroke();
      };
      const w = r * 1.15;
      strand(1, false, `rgba(${a},0.75)`, w);
      strand(-1, false, `rgba(${b},0.75)`, w);
      for (const [sign, col] of [[1, a], [-1, b]] as const) {
        strand(sign, true, `rgba(${this.ink},0.5)`, w + 2); // 压在上面的那股先描一圈暗边
        strand(sign, true, `rgba(${col},1)`, w);
      }
    }

    // 石墨轮廓：两遍，略有错位 → 手绘重描的感觉
    ctx.strokeStyle = `rgba(${this.ink},0.85)`;
    ctx.lineWidth = 1.3;
    this.polyline(pts, r, pts, 0.9, boil * 7);
    this.polyline(pts, -r, pts, 0.9, boil * 7 + 3);
    ctx.strokeStyle = `rgba(${this.ink},0.32)`;
    ctx.lineWidth = 0.9;
    this.polyline(pts, r + 0.9, pts, 1.4, boil * 7 + 11);
    this.polyline(pts, -r - 0.8, pts, 1.4, boil * 7 + 17);
    // 受光对侧的暗线，增加体积
    ctx.strokeStyle = `rgba(${this.ink},0.22)`;
    ctx.lineWidth = 2;
    this.polyline(pts, r * 0.55, pts, 0.6, 5);
  }

  private drawCanopy(ax: number, ay: number) {
    const ctx = this.ctx;
    const rx = this.u * 0.3;
    const ry = this.u * 0.075;
    const cy = ay - this.u * 0.03;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ax, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = `rgba(${this.ink},0.4)`;
    ctx.lineWidth = 1;
    for (let x = -rx * 1.2; x < rx * 1.2; x += 4.5) {
      ctx.beginPath();
      ctx.moveTo(ax + x, cy - ry);
      ctx.lineTo(ax + x + ry * 1.4, cy + ry);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = `rgba(${this.ink},0.8)`;
    ctx.lineWidth = 1.4;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const j = (hash(i + pass * 9) - 0.5) * 1.4;
        const x = ax + Math.cos(a) * (rx + j);
        const y = cy + Math.sin(a) * (ry + j * 0.5);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private bodyShape(path: Array<[number, number]>) {
    const ctx = this.ctx;
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  /** 蓄力/松手时握把周围的荧光笔涂块 + 放射线（局部坐标，k = 强度 0~1） */
  private paintBurst(boil: number, k: number) {
    const ctx = this.ctx;
    const u = this.u;
    const cx = 0;
    const cy = (BODY_Y0 + this.BH * 0.5) * u;
    ctx.strokeStyle = `rgba(${this.skin.cord.hl},${0.7 * k})`;
    ctx.lineWidth = 11;
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const y = cy - 0.36 * u + i * 0.09 * u;
      const x = (i % 2 ? 1 : -1) * 0.27 * u;
      if (i === 0) ctx.moveTo(-x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(${this.ink},${0.75 * k})`;
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.5 + (boil - 1) * 0.04;
      const r0 = 0.4 * u;
      const r1 = r0 + (0.08 + hash(i + boil) * 0.05) * u;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0 * 0.8, cy + Math.sin(a) * r0 * 1.05);
      ctx.lineTo(cx + Math.cos(a) * r1 * 0.8, cy + Math.sin(a) * r1 * 1.05);
      ctx.stroke();
    }
  }

  private getHandleSprite(boil: number) {
    const key = boil * 2 + (this.armed ? 1 : 0);
    let sprite = this.sprites.get(key);
    if (!sprite) {
      sprite = this.bake(() => this.paintBody(boil, this.armed));
      this.sprites.set(key, sprite);
    }
    return sprite;
  }

  private getShadowSprite() {
    const u = this.u;
    return (this.shadowSprite ??= this.bake(() => {
      const c = this.ctx;
      const R = (HALF_BY[this.skin.cord.handle.kind] + 0.02) * u;
      const bot = (BODY_Y0 + this.BH) * u;
      this.bodyShape(this.bodyPath);
      c.fillStyle = `rgba(${this.ink},0.06)`;
      c.fill();
      c.clip();
      c.strokeStyle = `rgba(${this.ink},0.28)`;
      c.lineWidth = 1;
      c.beginPath();
      for (let x = -R - bot; x < R + 8; x += 4.5) {
        c.moveTo(x, BODY_Y0 * u);
        c.lineTo(x + bot, bot + BODY_Y0 * u);
      }
      c.stroke();
    }, false));
  }

  /** 握把本体（局部坐标，原点在绳端）。只在烘焙贴图时调用。 */
  private paintBody(boil: number, armed: boolean) {
    const ctx = this.ctx;
    const u = this.u;
    const hd = this.skin.cord.handle;
    const rp = this.skin.cord.rope;
    const kind = hd.kind;
    const BY = (t: number) => (BODY_Y0 + this.BH * t) * u;
    const ink = this.ink;

    // 绳端的固定件：水瓶是一圈挂环，其余是绳结
    const fh = FERRULE_H * u;
    if (kind === "bottle" || kind === "compass") {
      ctx.strokeStyle = `rgba(${hd.c2},1)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.5, 0.045 * u, fh * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${ink},0.85)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.5, 0.045 * u + 1.6, fh * 0.62 + 1.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.55, 0.05 * u, fh * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rp.a},0.95)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${ink},0.6)`;
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-0.04 * u, fh * 0.55 + i * 5);
        ctx.lineTo(0.04 * u, fh * 0.55 + i * 5 - 4);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${ink},0.9)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // 铺底色，再按材质排线/加细节（以下都裁在轮廓里）
    this.bodyShape(this.bodyPath);
    ctx.fillStyle = `rgba(${hd.c1},${Math.min(1, BASE_ALPHA[kind] + (armed ? 0.08 : 0))})`;
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (const s of this.bodyStrokes) {
      ctx.strokeStyle = s.dark ? `rgba(${hd.c2},${s.a})` : `rgba(${hd.c2},${s.a * 0.55})`;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x - s.dx / 2, s.y - s.dy / 2);
      ctx.lineTo(s.x + s.dx / 2, s.y + s.dy / 2);
      ctx.stroke();
    }

    if (kind === "fried") {
      // 煎边：贴着轮廓内侧一圈焦黄
      this.bodyShape(this.bodyPath);
      ctx.strokeStyle = `rgba(${hd.c2},0.9)`;
      ctx.lineWidth = 8;
      ctx.stroke();
      // 蛋黄：偏一点，带排线与高光
      const cx = -0.015 * u;
      const cy = BY(0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, 0.105 * u, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hd.c4},0.97)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${ink},0.7)`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.strokeStyle = "rgba(214,100,10,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const y = cy - 0.02 * u + i * 0.015 * u;
        ctx.moveTo(cx + 0.02 * u, y + 0.04 * u);
        ctx.lineTo(cx + 0.09 * u, y - 0.02 * u);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.ellipse(cx - 0.04 * u, cy - 0.045 * u, 0.02 * u, 0.012 * u, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "bottle") {
      // 水：水位线以下更深，水面带一点波纹
      const lvl = BY(0.32);
      ctx.beginPath();
      ctx.moveTo(-0.2 * u, lvl);
      for (let x = -0.2; x <= 0.2; x += 0.02) ctx.lineTo(x * u, lvl + Math.sin(x * 30) * 2.4);
      ctx.lineTo(0.2 * u, BY(1) + 10);
      ctx.lineTo(-0.2 * u, BY(1) + 10);
      ctx.closePath();
      ctx.fillStyle = `rgba(${hd.c4},0.5)`;
      ctx.fill();
      // 瓶盖：蓝色实心，竖纹
      ctx.fillStyle = `rgba(${hd.c2},0.95)`;
      ctx.fillRect(-0.1 * u, BY(0) - 2, 0.2 * u, BY(0.1) - BY(0) + 2);
      ctx.strokeStyle = `rgba(${ink},0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -0.045; x <= 0.046; x += 0.03) {
        ctx.moveTo(x * u, BY(0));
        ctx.lineTo(x * u, BY(0.1));
      }
      ctx.stroke();
      // 标签：白带 + 蓝色波浪
      ctx.fillStyle = `rgba(${hd.c3},0.92)`;
      ctx.fillRect(-0.2 * u, BY(0.5), 0.4 * u, BY(0.7) - BY(0.5));
      ctx.strokeStyle = `rgba(${hd.c2},0.9)`;
      ctx.lineWidth = 2;
      for (const t of [0.57, 0.63]) {
        ctx.beginPath();
        for (let x = -0.2; x <= 0.2; x += 0.02) {
          const y = BY(t) + Math.sin(x * 34 + t * 9) * 3;
          if (x === -0.2) ctx.moveTo(x * u, y);
          else ctx.lineTo(x * u, y);
        }
        ctx.stroke();
      }
      // 瓶身横纹
      ctx.strokeStyle = `rgba(${hd.c3},0.7)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const t of [0.8, 0.86, 0.92]) {
        ctx.moveTo(-0.2 * u, BY(t));
        ctx.lineTo(0.2 * u, BY(t));
      }
      ctx.stroke();
    } else if (kind === "poop") {
      // 螺旋分层线
      ctx.strokeStyle = `rgba(${hd.c2},0.95)`;
      ctx.lineWidth = 2.4;
      for (const t of [0.3, 0.58]) {
        ctx.beginPath();
        ctx.moveTo(-0.26 * u, BY(t) + 5);
        ctx.quadraticCurveTo(0, BY(t) + 0.06 * u, 0.26 * u, BY(t) - 5);
        ctx.stroke();
      }
      // 每层左侧一道高光
      ctx.strokeStyle = `rgba(${hd.c3},0.85)`;
      ctx.lineWidth = 2.2;
      for (const [t, x, len] of [[0.17, -0.035, 0.05], [0.43, -0.085, 0.08], [0.72, -0.13, 0.1]] as const) {
        ctx.beginPath();
        ctx.moveTo(x * u, BY(t) - len * u * 0.5);
        ctx.quadraticCurveTo((x - 0.02) * u, BY(t), x * u, BY(t) + len * u * 0.5);
        ctx.stroke();
      }
      // 笑脸：眼白 + 瞳孔 + 嘴 + 腮红
      const ey = BY(0.76);
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * 0.075 * u, ey, 0.047 * u, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${hd.c4},1)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${ink},0.9)`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx * 0.068 * u, ey + 0.006 * u, 0.02 * u, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ink},0.95)`;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sx * 0.14 * u, ey + 0.06 * u, 0.026 * u, 0.016 * u, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(235,120,100,0.45)";
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${ink},0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, ey + 0.035 * u, 0.06 * u, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    } else if (kind === "compass") {
      const cx = 0;
      const cy = BY(0.5);
      const R = 0.23 * u;
      // 黄铜外圈 + 内侧细线
      this.bodyShape(this.bodyPath);
      ctx.strokeStyle = `rgba(${hd.c2},1)`;
      ctx.lineWidth = 13;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,240,190,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${ink},0.8)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 7, 0, Math.PI * 2);
      ctx.stroke();
      // 刻度：每 15° 一道，每 90° 一道长的
      ctx.strokeStyle = `rgba(${ink},0.8)`;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const long = i % 6 === 0;
        const r0 = R - 9;
        const r1 = r0 - (long ? 0.05 : 0.026) * u;
        ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
        ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      }
      ctx.stroke();
      // 东南西北
      ctx.font = `700 ${0.052 * u}px "Songti SC", "Noto Serif SC", serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const [ch, a, red] of [["N", 0, true], ["E", 90, false], ["S", 180, false], ["W", 270, false]] as const) {
        const rr = R - 9 - 0.095 * u;
        const rad = (a * Math.PI) / 180;
        ctx.fillStyle = red ? `rgba(${hd.c4},1)` : `rgba(${ink},0.85)`;
        ctx.fillText(ch, cx + Math.sin(rad) * rr, cy - Math.cos(rad) * rr + 1);
      }
      // 指针：红头白尾，微微偏离正北，像是刚转过
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.55);
      const L = 0.115 * u;
      const W2 = 0.032 * u;
      ctx.beginPath();
      ctx.moveTo(0, -L);
      ctx.lineTo(W2, 0);
      ctx.lineTo(-W2, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(${hd.c4},1)`;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, L);
      ctx.lineTo(W2, 0);
      ctx.lineTo(-W2, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(${hd.c3},1)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${ink},0.9)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(0, -L);
      ctx.lineTo(W2, 0);
      ctx.lineTo(0, L);
      ctx.lineTo(-W2, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, 0.016 * u, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hd.c2},1)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${ink},0.85)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // 枕头：内缝线（虚线）+ 中间的纽扣 + 向四角放射的褶皱
      const cy = BY(0.5);
      ctx.save();
      ctx.translate(0, cy);
      ctx.scale(0.86, 0.8);
      ctx.translate(0, -cy);
      this.bodyShape(this.bodyPath);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = `rgba(${hd.c2},0.95)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(${hd.c2},0.85)`;
      ctx.lineWidth = 1.3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        ctx.beginPath();
        ctx.moveTo(sx * 0.035 * u, cy + sy * 0.03 * u);
        ctx.quadraticCurveTo(sx * 0.1 * u, cy + sy * 0.045 * u, sx * 0.17 * u, cy + sy * 0.12 * u);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, cy, 0.03 * u, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hd.c4},0.95)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${ink},0.7)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const [dx, dy] of [[-1, -1], [1, 1]] as const) {
        ctx.beginPath();
        ctx.arc(dx * 0.008 * u, dy * 0.008 * u, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // 石墨轮廓
    const set = this.outlines[boil] ?? this.outlines[0];
    set.forEach((poly, pass) => {
      ctx.strokeStyle = `rgba(${ink},${pass === 0 ? 0.9 : 0.4})`;
      ctx.lineWidth = pass === 0 ? 1.5 : 1;
      this.bodyShape(poly);
      ctx.stroke();
    });
    // 高光处只描一小段弧线
    const h = HL[kind];
    ctx.strokeStyle = kind === "poop" ? `rgba(${hd.c3},0.9)` : `rgba(${ink},0.35)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(h.x * u, BY(h.t), (h.rx + 0.006) * u, (h.ry + 0.006) * u, 0.12, Math.PI * 0.85, Math.PI * 1.55);
    ctx.stroke();
  }
}
