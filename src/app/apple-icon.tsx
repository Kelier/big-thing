import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS 添加到主屏幕用的图标（iOS 不认 SVG favicon）：煎蛋，和默认皮肤一致 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" fill="#FFF0B8" />
        <path
          d="M10 31c-2-11 8-19 19-17 8-4 21 0 23 11 6 4 5 15-3 19-4 8-17 10-24 6-9 3-17-6-15-19z"
          fill="#fff"
          stroke="#4A2C14"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <circle cx="31" cy="34" r="10" fill="#F7A325" stroke="#4A2C14" strokeWidth="2.2" />
        <ellipse cx="27.5" cy="30.5" rx="3" ry="2" fill="#fff" opacity="0.85" transform="rotate(-30 27.5 30.5)" />
      </svg>
    ),
    size,
  );
}
