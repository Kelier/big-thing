# 今天吃点啥 · A Random Life Machine

一个手绘铅笔风、物理拉绳驱动的生活决策玩具：拉一下抽类别（菜系），再拉一下在类别里抽一家。

```bash
npm install
npm run dev      # http://localhost:4827
```

## 技术栈
Next.js 16 · React 19 · TypeScript · Canvas2D · Zustand · Motion

## 结构
- `components/pull-cord/engine.ts` 拉绳核心：弹簧阻尼 + Verlet 绳段 + 弯曲刚度（物理），以及 Canvas2D 铅笔渲染（石墨轮廓“沸腾”抖动、彩铅排线填色、涂抹阴影、纸面颗粒、手写批注）。高频状态全在类里，不进 React。`PencilCord.tsx` 是 React 封装。
- `components/layout/SketchDefs.tsx` 全站手绘 SVG 滤镜（`#rough` 线条手抖、`#pencil` 大字石墨颗粒）。
- `public/fonts/` 自托管的**按需子集**字体（Noto Serif SC 900 + Long Cang）。新增文案后运行 `npm run fonts` 重新生成（需要 fonttools，见脚本头部注释）。
- `stores/decision-store.ts` 业务状态机：`idle → dragging → releasing → revealingCuisine → cuisineSelected → revealingRestaurant → restaurantSelected`。
- `services/poi-provider.ts` 客户端地点服务：定位 → 请求 `/api/poi` → 任何一步失败都退回 `data/cuisine-categories.ts` 里的**虚构示例数据**。
- `app/api/poi/route.ts` + `services/poi-server.ts` 服务端取数：有 `AMAP_KEY` 用**高德周边搜索**，否则（或高德失败时）用 **OpenStreetMap / Overpass**。key 只在服务端。
- `services/random-picker.ts` 随机 + 重复抑制；“距离/价格优先”= 在最优 3 家里随机。

## 模式

- **01 / ROLL（拉绳）**：吃 / 喝 / 拉（找厕所）/ 睡（酒店·民宿·旅馆）。拉绳先抽品类，再拉一次抽具体地点。
- **02 / MAP（地图）**：随机“今天干什么”。底下是真实地图（OpenFreeMap 矢量瓦片，运行时改成纸面铅笔配色，无需 key），抽中品类后附近地标以图钉掉到地图上；点图钉可选中并查看，拖动地图后可“搜这一带”，“我在哪”回到定位。
- MapLibre 的 worker 由 `scripts/copy-map-worker.mjs`（postinstall）复制到 `public/vendor/`，Turbopack 打包后的 worker 无法加载。
- 注意：OSM 官方栅格瓦片在部分网络下不可达，所以底图用 OpenFreeMap；WebGL 不可用时地图区显示提示，拉绳抽取不受影响。

## 真实地点数据
复制 `.env.example` 为 `.env.local` 并填入高德 Web 服务 Key（[高德开放平台](https://console.amap.com) → 应用管理 → 创建应用 → 添加 Key，服务平台选“Web服务”；个人开发者有免费额度，具体以控制台为准）。**不填也能用**，会自动走 OSM，但：

- OSM 用的是公共 Overpass 服务器，偶尔很慢（首次请求可能要十几秒）或被限流；国内数据比高德少，也没有人均价格。
- 同一位置、同一模式只请求一次上游（按 mode 批量取回再本地按分类筛选），并缓存 30 分钟。
- 浏览器定位只在 `https` 或 `localhost` 下可用；用局域网 IP 访问时会退回示例数据。

## 降级
- 点按握把、或主按钮，都能“代拉”（无需拖拽）。
- `prefers-reduced-motion`：去掉待机摆动与滚动动画。

## 待办（P1/P2）
地图模式（MapLibre 展示结果位置）、分享卡片、手动选择城市（拒绝定位时）。
