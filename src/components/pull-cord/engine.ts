/**
 * 铅笔拉绳引擎：物理（弹簧阻尼 + Verlet 绳段）与 Canvas2D 铅笔渲染。
 * 高频状态全部留在这个类里，不进 React。
 *
 * 物理在“世界单位”下计算（视口高度固定为 VH），渲染时再乘 u 转成像素。
 */

import { SKINS, type HandleKind, type Skin } from "@/data/skins";

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
  /** 绳子旁的手写批注，null 则隐藏 */
  label: string | null;
};

type Stroke = { x: number; y: number; dx: number; dy: number; a: number; w: number; dark: boolean };

// 握把轮廓。t∈[0,1]，返回半宽（世界单位）
const HANDLE_R: Record<HandleKind, (t: number) => number> = {
  // 木汤勺：细柄 + 椭圆勺头，挂在绳端
  spoon: (t) => {
    if (t < 0.42) return 0.042 + 0.012 * t;
    const s = (t - 0.42) / 0.58;
    return 0.046 * (1 - s) + 0.205 * Math.pow(Math.sin(Math.PI * s), 0.8);
  },
  // 搪瓷铃：圆顶 + 微微外翻的裙边
  bell: (t) => 0.03 + 0.17 * Math.pow(1 - (1 - t) ** 2.4, 0.9) + 0.022 * t ** 10,
  // 溏心蛋：上窄下宽的蛋形
  egg: (t) => 0.205 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.88)), 0.52),
};
/** 命中区中心在握把上的相对位置 */
const HIT_T: Record<HandleKind, number> = { spoon: 0.62, bell: 0.5, egg: 0.5 };
/** 高光位置（相对握把）：t 与水平偏移 */
const HL: Record<HandleKind, { t: number; x: number; rx: number; ry: number }> = {
  spoon: { t: 0.72, x: -0.08, rx: 0.035, ry: 0.09 },
  bell: { t: 0.42, x: -0.085, rx: 0.035, ry: 0.1 },
  egg: { t: 0.36, x: -0.08, rx: 0.04, ry: 0.1 },
};
/** 底色铺得多实：木头/搪瓷/蛋白都是实心的，不像彩铅那样透 */
const BASE_ALPHA: Record<HandleKind, number> = { spoon: 0.88, bell: 0.92, egg: 0.96 };
const BODY_Y0 = 0.13;
const BODY_H = 0.68;
const FERRULE_H = 0.15;

export class CordEngine {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private u = 1;
  private vw = 1;
  private raf = 0;
  private lastT = 0;
  private fontReady = false;

  private skin: Skin = SKINS.bbq;
  private cfg = { anchorX: 0, anchorY: 0, restLength: 0, maxPull: 0, threshold: 0, narrow: false };
  private opts: CordOptions = { reducedMotion: false, hasResult: false, label: null };

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
  private labelAlpha = 0;
  private labelText = "";

  // ---- 预生成的手绘素材（按像素尺寸，resize 时重建）----
  private bodyStrokes: Stroke[] = [];
  private bodyPath: Array<[number, number]> = [];
  private outlines: Array<Array<Array<[number, number]>>> = [];
  private grain: CanvasPattern | null = null;
  private cleanup: Array<() => void> = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: CordCallbacks,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.makeGrain();
    this.bindPointer();
    // 手写字体：加载完成后批注才会用它绘制
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts
        .load('28px "WTE Hand"')
        .then(() => (this.fontReady = true))
        .catch(() => undefined);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.canvas.style.cursor = "";
  }

  setOptions(o: Partial<CordOptions>) {
    this.opts = { ...this.opts, ...o };
    this.computeCfg();
  }

  resize(W: number, H: number, dpr: number) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.u = H / VH;
    this.vw = W / this.u;
    this.computeCfg();
    this.buildHandle();
  }

  private get ink() {
    return this.skin.cord.ink;
  }

  setSkin(skin: Skin) {
    if (this.skin === skin) return;
    this.skin = skin;
    if (this.u > 1) this.buildHandle();
  }

  /** 代拉：按钮、点按、减少动效用户都走这里。 */
  autoPull() {
    if (this.dragging || this.auto || !this.cb.canStart()) return;
    this.cb.onStart();
    this.auto = { t: 0 };
  }

  private computeCfg() {
    const narrow = this.W < 760;
    const restLength = VH * (narrow ? (this.opts.hasResult ? 0.16 : 0.3) : 0.44);
    const maxPull = VH * (narrow ? 0.17 : 0.2);
    this.cfg = {
      narrow,
      anchorX: narrow ? 0 : this.vw * 0.2,
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
    return this.H / 2 - y * this.u;
  }

  // ======================= 输入 =======================
  private handleCenter() {
    const o = (NODE_COUNT - 1) * 2;
    const ex = this.px(this.p[o]);
    const ey = this.py(this.p[o + 1]);
    // 握把沿局部 +y 延伸，整体旋转 -angle（canvas 的 y 向下）
    const len = (BODY_Y0 + BODY_H * HIT_T[this.skin.cord.handle.kind]) * this.u;
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
        this.hover = h;
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
      this.dragX = clamp(dx * 0.55, -0.7, 0.7);
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
    if (next && typeof navigator !== "undefined" && "vibrate" in navigator) {
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
    const idleSway = reduced ? 0 : Math.sin(t * 0.9) * 0.03 + Math.sin(t * 0.37 + 1) * 0.02;
    for (let k = 0; k < SUB; k++) {
      let pullT = 0;
      let xT = idleSway;
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

    // 手柄角度：取末端四段的整体方向，带弹簧延迟 → 过冲摆动
    const o = (N - 1) * 2;
    const target = clamp(Math.atan2(-(p[o - 8] - p[o]), p[o - 7] - p[o + 1]), -1.1, 1.1);
    this.angleV += ((target - this.angle) * 150 - this.angleV * 12) * dt;
    this.angle += this.angleV * dt;
  }

  // ======================= 手绘素材 =======================
  private makeGrain() {
    // 纸面颗粒：固定在屏幕上的噪点，用 destination-out 把笔触“蚀”出纸纹
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
    this.grain = this.ctx.createPattern(c, "repeat");
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
      const r = Math.max(handleR(t), 0.0005) * u;
      const y = (BODY_Y0 + BODY_H * t) * u;
      right.push([r, y]);
      left.push([-r, y]);
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
    const maxR = 0.2 * u;
    const y0 = BODY_Y0 * u;
    const y1 = (BODY_Y0 + BODY_H) * u;
    const h = HL[kind];
    const hl = { x: h.x * u, y: (BODY_Y0 + BODY_H * h.t) * u, rx: h.rx * u, ry: h.ry * u };
    const want = kind === "bell" ? 160 : kind === "egg" ? 420 : 560;
    for (let i = 0, n = 0; n < want && i < 6000; i++) {
      const x = (hash(i * 1.91 + 1) * 2 - 1) * maxR;
      const y = y0 + hash(i * 2.73 + 2) * (y1 - y0);
      const t = (y - y0) / (y1 - y0);
      if (Math.abs(x) > Math.max(handleR(t), 0.001) * u * 0.94) continue;
      const hx = (x - hl.x) / hl.rx;
      const hy = (y - hl.y) / hl.ry;
      if (hx * hx + hy * hy < 1) continue;
      const dark = x > 0.03 * u || t > 0.85;
      // 蛋白只在背光侧排线，其余留白
      if (kind === "egg" && !dark) continue;
      // 木纹顺着勺柄走，其余是斜向排线
      const ang =
        kind === "spoon" ? Math.PI / 2 + (hash(i * 7.7) - 0.5) * 0.3 : dark && hash(i * 7.7) > 0.5 ? -0.8 : 0.95;
      const len = (6 + hash(i * 4.1 + 3) * 10) * (u / 160) * (kind === "spoon" ? 1.6 : 1);
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
  }

  // ======================= 渲染 =======================
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (this.W === 0) return;
    const dt = Math.min((now - (this.lastT || now)) / 1000, 1 / 30);
    this.lastT = now;
    this.step(dt, now / 1000);
    this.draw(now);
  };

  private draw(now: number) {
    const ctx = this.ctx;
    const u = this.u;
    const reduced = this.opts.reducedMotion;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // “沸腾”：轮廓每 140ms 在三个变体间切换，像手绘动画的逐帧抖动
    const boil = reduced ? 0 : Math.floor(now / 140) % 3;

    const N = NODE_COUNT;
    const o = (N - 1) * 2;
    const ex = this.px(this.p[o]);
    const ey = this.py(this.p[o + 1]);
    const ax = this.px(this.cfg.anchorX);
    const ay = this.py(this.cfg.anchorY);

    const pts = this.samplePath();
    this.drawShadows(pts, ex, ey);
    this.drawCanopy(ax, ay);
    this.drawRope(pts, boil);
    this.drawHandle(ex, ey, boil);
    this.drawLabel(ex, ey, now);

    // 纸面颗粒：只处理绳子所在的竖条，省性能
    if (this.grain) {
      const x0 = Math.max(0, ax - 340);
      const x1 = Math.min(this.W, ax + 340);
      const y1 = Math.min(this.H, ey + 1.2 * u);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = this.grain;
      ctx.fillRect(x0 * this.dpr, 0, (x1 - x0) * this.dpr, y1 * this.dpr);
      ctx.restore();
    }
  }

  /** Catmull–Rom 采样，返回像素坐标 + 法线 + 距手柄的弧长。 */
  private samplePath() {
    const N = NODE_COUNT;
    const S = 96;
    const p = this.p;
    const out: Array<{ x: number; y: number; nx: number; ny: number; tx: number; ty: number; s: number }> = [];
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
      out.push({ x: this.px(cr(0)), y: this.py(cr(1)), nx: 0, ny: 0, tx: 0, ty: 0, s: 0 });
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
      const jx = (hash(j * 1.7 + seed) - 0.5) * jitter;
      const jy = (hash(j * 2.3 + seed + 40) - 0.5) * jitter;
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
    /** 沿弧长等距的斜向笔触：绳子的“捻股”，随手柄一起走 */
    const twist = (pitch: number, width: (k: number) => number, color: (k: number) => string, lean: number, fuzz: boolean) => {
      for (let j = 0; j < pts.length - 1; j++) {
        const p0 = pts[j];
        const p1 = pts[j + 1];
        const k0 = Math.ceil(p1.s / pitch);
        const k1 = Math.floor(p0.s / pitch);
        for (let k = k0; k <= k1; k++) {
          const f = (p0.s - k * pitch) / Math.max(p0.s - p1.s, 1e-6);
          const x = p0.x + (p1.x - p0.x) * f + (hash(k * 3.3) - 0.5) * 1.2;
          const y = p0.y + (p1.y - p0.y) * f;
          const L = r * (1.15 + hash(k * 1.1) * 0.25);
          // 对角线方向 = 法线 + 切线
          const dx = p0.nx * L + p0.tx * L * lean;
          const dy = p0.ny * L + p0.ty * L * lean;
          ctx.strokeStyle = color(k);
          ctx.lineWidth = width(k);
          ctx.beginPath();
          ctx.moveTo(x - dx, y - dy);
          ctx.lineTo(x + dx, y + dy);
          ctx.stroke();
          // 麻绳边缘翘出来的毛刺
          if (fuzz && hash(k * 9.1) > 0.55) {
            const side = hash(k * 5.5) > 0.5 ? 1 : -1;
            const bx = x + dx * side;
            const by = y + dy * side;
            ctx.strokeStyle = `rgba(${this.ink},0.5)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + p0.nx * side * 3.5 + p0.tx * 2, by + p0.ny * side * 3.5 + p0.ty * 2);
            ctx.stroke();
          }
        }
      }
    };

    if (kind === "hemp") {
      // 麻绳：焦糖底，淡黄与焦糖相间的粗股
      ctx.strokeStyle = `rgba(${b},0.95)`;
      ctx.lineWidth = r * 2;
      centerline();
      ctx.stroke();
      twist(r * 1.3, (k) => (k % 2 === 0 ? 2.8 : 1.8), (k) => (k % 2 === 0 ? `rgba(${a},0.95)` : `rgba(${b},0.9)`), 0.85, true);
    } else if (kind === "braid") {
      // 面条绳：橙黄麻花，亮面在一侧
      ctx.strokeStyle = `rgba(${a},0.95)`;
      ctx.lineWidth = r * 2;
      centerline();
      ctx.stroke();
      twist(r * 1.7, (k) => (k % 2 === 0 ? 3.4 : 2), (k) => (k % 2 === 0 ? `rgba(${b},0.95)` : `rgba(${this.ink},0.2)`), 0.6, false);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2.2;
      this.polyline(pts, -r * 0.5, pts, 0.5, 31);
    } else {
      // 双色棉线：两股相互缠绕，用正反面遮挡做出螺旋
      const pitch = r * 7;
      const amp = r * 0.5;
      const phase = (s: number) => (s / pitch) * Math.PI * 2;
      const strand = (sign: number, front: boolean, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        for (let j = 0; j < pts.length - 1; j++) {
          const p0 = pts[j];
          const p1 = pts[j + 1];
          const ph = phase((p0.s + p1.s) / 2);
          if (front && sign * Math.cos(ph) <= 0) continue;
          const o0 = sign * amp * Math.sin(phase(p0.s));
          const o1 = sign * amp * Math.sin(phase(p1.s));
          ctx.beginPath();
          ctx.moveTo(p0.x + p0.nx * o0, p0.y + p0.ny * o0);
          ctx.lineTo(p1.x + p1.nx * o1, p1.y + p1.ny * o1);
          ctx.stroke();
        }
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

  private drawShadows(pts: ReturnType<CordEngine["samplePath"]>, ex: number, ey: number) {
    const ctx = this.ctx;
    const u = this.u;
    // 下拉越多，手柄离墙越远，影子偏得越开
    const off = u * (0.16 + Math.max(0, this.pull) * 0.06);
    const dx = off;
    const dy = off * 0.32;

    // 绳影：石墨涂抹
    for (const [w, a] of [
      [16, 0.035],
      [10, 0.045],
      [5, 0.06],
    ] as const) {
      ctx.strokeStyle = `rgba(${this.ink},${a})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((pt, j) => (j ? ctx.lineTo(pt.x + dx, pt.y + dy) : ctx.moveTo(pt.x + dx, pt.y + dy)));
      ctx.stroke();
    }

    // 握把影：斜线排线
    ctx.save();
    ctx.translate(ex + dx * 1.15, ey + dy * 1.15);
    ctx.rotate(-this.angle);
    this.bodyShape(this.bodyPath);
    ctx.fillStyle = `rgba(${this.ink},0.06)`;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = `rgba(${this.ink},0.28)`;
    ctx.lineWidth = 1;
    const R = 0.22 * u;
    const bot = (BODY_Y0 + BODY_H) * u;
    for (let x = -R - bot; x < R + 8; x += 4.5) {
      ctx.beginPath();
      ctx.moveTo(x, BODY_Y0 * u);
      ctx.lineTo(x + bot, bot + BODY_Y0 * u);
      ctx.stroke();
    }
    ctx.restore();
  }

  private bodyShape(path: Array<[number, number]>) {
    const ctx = this.ctx;
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  private drawHandle(ex: number, ey: number, boil: number) {
    const ctx = this.ctx;
    const u = this.u;
    const sx = this.dragging ? 1.04 : this.hover ? 1.03 : 1;

    // 达到阈值：荧光笔涂一块，再加几道放射线
    if (this.armed || this.impact > 0.02) {
      const k = this.armed ? 1 : this.impact;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-this.angle);
      const cx = 0;
      const cy = (BODY_Y0 + BODY_H * 0.5) * u;
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
      ctx.restore();
    }

    const hd = this.skin.cord.handle;
    const rp = this.skin.cord.rope;
    const kind = hd.kind;
    const BY = (t: number) => (BODY_Y0 + BODY_H * t) * u;

    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(-this.angle);
    ctx.scale(sx, 1);

    // 绳端的固定件：铃铛是金属圈，其余是绳结
    const fh = FERRULE_H * u;
    if (kind === "bell") {
      ctx.strokeStyle = `rgba(${hd.c4},1)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.5, 0.045 * u, fh * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${this.ink},0.85)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.5, 0.045 * u + 1.6, fh * 0.62 + 1.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, fh * 0.55, 0.05 * u, fh * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${kind === "spoon" ? rp.a : rp.b},0.95)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${this.ink},0.6)`;
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-0.04 * u, fh * 0.55 + i * 5);
        ctx.lineTo(0.04 * u, fh * 0.55 + i * 5 - 4);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${this.ink},0.9)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // 铃铛的舌：先画，被壳盖住一半
    if (kind === "bell") {
      ctx.beginPath();
      ctx.arc(0, BY(1) + 0.03 * u, 0.04 * u, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hd.c4},1)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${this.ink},0.85)`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    // 铺底色，再按材质排线/加细节
    this.bodyShape(this.bodyPath);
    const baseA = Math.min(1, BASE_ALPHA[kind] + (this.armed ? 0.08 : 0));
    ctx.fillStyle = `rgba(${hd.c1},${baseA})`;
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

    if (kind === "spoon") {
      // 勺心：凹下去的一块，颜色更深
      ctx.beginPath();
      ctx.ellipse(0.01 * u, BY(0.78), 0.125 * u, 0.135 * u, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hd.c4},0.4)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${hd.c2},0.9)`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${hd.c4},0.55)`;
      ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 0.03 * u - 0.03 * u, BY(0.78) + 0.1 * u);
        ctx.lineTo(i * 0.03 * u + 0.03 * u, BY(0.78) - 0.1 * u);
        ctx.stroke();
      }
    } else if (kind === "bell") {
      // 裙边一圈白条，像搪瓷杯口的描边
      for (const [t, w] of [[0.9, 0.032], [0.8, 0.012]] as const) {
        ctx.strokeStyle = `rgba(${hd.c3},0.95)`;
        ctx.lineWidth = w * u;
        ctx.beginPath();
        ctx.moveTo(-0.3 * u, BY(t) + 3);
        ctx.quadraticCurveTo(0, BY(t) + 9, 0.3 * u, BY(t) + 3);
        ctx.stroke();
      }
    } else {
      // 溏心：橙黄的蛋黄，偏下，带一点高光
      const cy = BY(0.56);
      ctx.beginPath();
      ctx.arc(0.005 * u, cy, 0.108 * u, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hd.c4},0.97)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${this.ink},0.7)`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.strokeStyle = `rgba(214,100,10,0.55)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const y = cy - 0.02 * u + i * 0.015 * u;
        ctx.beginPath();
        ctx.moveTo(0.02 * u, y + 0.04 * u);
        ctx.lineTo(0.09 * u, y - 0.02 * u);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.ellipse(-0.04 * u, cy - 0.045 * u, 0.02 * u, 0.012 * u, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 石墨轮廓
    const set = this.outlines[boil] ?? this.outlines[0];
    set.forEach((poly, pass) => {
      ctx.strokeStyle = `rgba(${this.ink},${pass === 0 ? 0.9 : 0.4})`;
      ctx.lineWidth = pass === 0 ? 1.5 : 1;
      this.bodyShape(poly);
      ctx.stroke();
    });
    // 高光处只描一小段弧线
    const h = HL[kind];
    ctx.strokeStyle = kind === "spoon" ? `rgba(${hd.c3},0.9)` : `rgba(${this.ink},0.35)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(h.x * u, BY(h.t), (h.rx + 0.006) * u, (h.ry + 0.006) * u, 0.12, Math.PI * 0.85, Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();
  }

  private drawLabel(ex: number, ey: number, now: number) {
    const ctx = this.ctx;
    const u = this.u;
    const want = this.opts.label && !this.dragging && !this.auto && this.fontReady;
    this.labelAlpha += ((want ? 1 : 0) - this.labelAlpha) * 0.14;
    if (this.opts.label) this.labelText = this.opts.label;
    if (this.labelAlpha < 0.02 || !this.labelText) return;

    const side = this.cfg.narrow ? 1 : -1; // 桌面在左侧，手机在右侧
    const c = this.handleCenter();
    const bob = this.opts.reducedMotion ? 0 : Math.sin(now / 520) * 2.5;
    const size = this.cfg.narrow ? 26 : 32;
    const tx = c.x + side * (0.42 * u + (this.cfg.narrow ? 62 : 104));
    const ty = c.y - 0.1 * u + bob;

    ctx.save();
    ctx.globalAlpha = this.labelAlpha;
    ctx.translate(tx, ty);
    ctx.rotate(side * 0.07);
    ctx.font = `${size}px "WTE Hand", "Kaiti SC", "STKaiti", cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${this.ink},0.88)`;
    ctx.fillText(this.labelText, 0, 0);
    ctx.fillText(this.labelText, 0.6, 0.5); // 重描一遍，笔迹更实
    ctx.restore();

    // 手绘弯箭头：从文字指向握把
    ctx.save();
    ctx.globalAlpha = this.labelAlpha;
    ctx.strokeStyle = `rgba(${this.ink},0.8)`;
    ctx.lineWidth = 1.6;
    const sx = tx + side * -(this.cfg.narrow ? 34 : 52);
    const sy = ty + 6;
    const hxp = c.x + side * 0.37 * u;
    const hyp = c.y - 0.02 * u;
    const cx1 = (sx + hxp) / 2;
    const cy1 = sy + 26;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx1, cy1, hxp, hyp);
    ctx.stroke();
    // 箭头
    const ang = Math.atan2(hyp - cy1, hxp - cx1);
    for (const d of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(hxp, hyp);
      ctx.lineTo(hxp - Math.cos(ang + d) * 11, hyp - Math.sin(ang + d) * 11);
      ctx.stroke();
    }
    ctx.restore();
    void ex;
    void ey;
  }
}
