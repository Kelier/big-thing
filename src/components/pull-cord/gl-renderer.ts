/**
 * 拉绳的 WebGL 渲染器：每帧只有“把预先烘焙好的贴图贴上去”。
 *
 * Canvas 2D 每帧要用 CPU（iOS 上是 CoreGraphics）把几十条带圆角的宽描边重新栅格化，再上传成纹理；
 * 这里绳子的外观（捻股、轮廓、链节……）只在换皮肤/改尺寸时烘焙成一张可平铺的纹理，
 * 之后每帧 = 沿 Catmull–Rom 曲线铺一条三角带 + 几个贴图四边形，全部在 GPU 上完成，CPU 零描边。
 *
 * 坐标系：css 像素，原点左上，和 canvas 2D 完全一致；顶点数据 [x, y, u, v] 交错排布。
 * 混合：预乘 alpha（ONE, ONE_MINUS_SRC_ALPHA）。
 */

const VS = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uRes;
varying vec2 vUv;
void main() {
  vec2 c = aPos / uRes;
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;

const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uColor;
uniform float uTint;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (uTint > 0.5) {
    // 染色模式：只取贴图的 alpha 当形状，颜色由 uniform 给（影子、光晕）
    gl_FragColor = vec4(uColor.rgb * uColor.a * t.a, uColor.a * t.a);
  } else {
    gl_FragColor = t * uColor.a;
  }
}`;

export class GLRenderer {
  private gl!: WebGLRenderingContext;
  private prog!: WebGLProgram;
  private buf!: WebGLBuffer;
  private uRes!: WebGLUniformLocation;
  private uColor!: WebGLUniformLocation;
  private uTint!: WebGLUniformLocation;
  private textures = new Map<HTMLCanvasElement, WebGLTexture>();
  lost = false;
  /** 上下文丢失后恢复时回调：引擎据此重新唤醒、重新上传贴图 */
  private onRestore: (() => void) | null = null;
  setOnRestore(f: () => void) {
    this.onRestore = f;
  }

  /** 不支持 WebGL（或被禁用）就返回 null，引擎退回 Canvas 2D */
  private static supported: boolean | null = null;

  static create(canvas: HTMLCanvasElement): GLRenderer | null {
    // 先在一块临时画布上探测（只探测一次）：真画布一旦取过 webgl 上下文就再也拿不到 2d 了，探测失败必须不碰它
    if (GLRenderer.supported === null) {
      try {
        GLRenderer.supported = !!document.createElement("canvas").getContext("webgl");
      } catch {
        GLRenderer.supported = false;
      }
    }
    if (!GLRenderer.supported) return null;
    try {
      return new GLRenderer(canvas);
    } catch (e) {
      console.warn("[cord] WebGL 初始化失败，退回 Canvas 2D：", e);
      return null;
    }
  }

  private constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false, // 边缘抗锯齿已经在贴图里，不需要 MSAA（省显存和填充）
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("no webgl");
    this.gl = gl;
    this.init();
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  private onLost = (e: Event) => {
    e.preventDefault(); // 允许浏览器之后恢复
    this.lost = true;
  };
  private onRestored = () => {
    this.init();
    this.lost = false;
    this.onRestore?.();
  };

  private init() {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(prog);
    this.prog = prog;
    this.uRes = gl.getUniformLocation(prog, "uRes")!;
    this.uColor = gl.getUniformLocation(prog, "uColor")!;
    this.uTint = gl.getUniformLocation(prog, "uTint")!;
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);

    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const aPos = gl.getAttribLocation(prog, "aPos");
    const aUv = gl.getAttribLocation(prog, "aUv");
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.textures.clear(); // 上下文重建后旧纹理已失效
  }

  /** 设备像素尺寸 + css 像素尺寸（顶点用 css 像素） */
  resize(devW: number, devH: number) {
    this.canvas.width = devW;
    this.canvas.height = devH;
    this.gl.viewport(0, 0, devW, devH);
  }

  begin(cssW: number, cssH: number) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uRes, cssW, cssH);
  }

  /** 把烘焙好的 canvas 传成纹理并缓存；repeat 只能用于二的幂尺寸（WebGL1 限制） */
  private texture(c: HTMLCanvasElement, repeat: boolean) {
    let t = this.textures.get(c);
    if (!t) {
      const gl = this.gl;
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrapS = gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      this.textures.set(c, t);
    }
    return t;
  }

  /**
   * 画一个三角带。verts = [x,y,u,v]×n。
   * tint 非空时用贴图 alpha 当形状、染成该颜色（0~1）；否则直接贴图。alpha 是整体不透明度。
   */
  draw(c: HTMLCanvasElement, verts: Float32Array, n: number, alpha: number, opts: { repeat?: boolean; tint?: [number, number, number] } = {}) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture(c, !!opts.repeat));
    const t = opts.tint;
    gl.uniform1f(this.uTint, t ? 1 : 0);
    gl.uniform4f(this.uColor, t ? t[0] : 1, t ? t[1] : 1, t ? t[2] : 1, alpha);
    gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, n);
  }

  /** 丢掉一批贴图（引擎重新烘焙时调用，及时释放显存） */
  forget(list: Iterable<HTMLCanvasElement>) {
    for (const c of list) {
      const t = this.textures.get(c);
      if (t) {
        this.gl.deleteTexture(t);
        this.textures.delete(c);
      }
      c.width = c.height = 0; // iOS 上离屏 canvas 不主动清零就不会及时回收
    }
  }

  /**
   * 只释放自己创建的资源，不要 loseContext：React 严格模式（和模式切换）会在同一块 canvas 上
   * 卸载后立刻重建，而一块 canvas 只有一个上下文，丢掉就再也拿不回来了。
   */
  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    const gl = this.gl;
    if (gl.isContextLost()) return;
    for (const t of this.textures.values()) gl.deleteTexture(t);
    this.textures.clear();
    gl.deleteBuffer(this.buf);
    gl.deleteProgram(this.prog);
  }
}
