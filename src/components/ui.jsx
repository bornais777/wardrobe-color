import { useState } from "react";

// ── 图标（线性，1.6 描边，currentColor）─────────────────
const P = {
  hanger: <><path d="M12 8V7a2.2 2.2 0 1 0-2.2-2.2" /><path d="M12 8 3.3 14.4a1.6 1.6 0 0 0 .95 2.9h15.5a1.6 1.6 0 0 0 .95-2.9L12 8Z" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.4-1.3.5-2.6 1.9-2.6H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z" /><circle cx="7.6" cy="11" r=".9" fill="currentColor" stroke="none" /><circle cx="10.2" cy="7.4" r=".9" fill="currentColor" stroke="none" /><circle cx="14.6" cy="7.4" r=".9" fill="currentColor" stroke="none" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.2L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.2L20 15" /><path d="M20 20v-5h-5" /></>,
  chat: <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-7l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5Z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeoff: <><path d="M4 4l16 16" /><path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3.2 4.1M6.1 7.8A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 3.9-.8" /><path d="M9.9 10A2.8 2.8 0 0 0 14 14" /></>,
  edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 7.5 3 3" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M5 19h14" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4.5-4.5L13 16l2.5-2.5L19 17" /></>,
  sparkle: <><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /><path d="m7 7 2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevdown: <path d="m6 9 6 6 6-6" />,
  code: <><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" /></>,
};

export function Icon({ name, size = 20, stroke = 1.6, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {P[name]}
    </svg>
  );
}

// ── 脸型线稿 ───────────────────────────────────────────
const FACE = {
  round: <circle cx="20" cy="20" r="13" />,
  square: <rect x="8" y="8" width="24" height="24" rx="6" />,
  long: <ellipse cx="20" cy="20" rx="10" ry="16" />,
  oval: <path d="M20 5c7 0 11 7 11 15 0 9-5 15-11 15S9 29 9 20C9 12 13 5 20 5Z" />,
  heart: <path d="M8 14c0-6 6-8 12-6 6-2 12 0 12 6 0 8-6 16-12 21C14 30 8 22 8 14Z" />,
  diamond: <path d="M20 4.5 32 20 20 35.5 8 20Z" />,
  pear: <path d="M20 5c5 0 7 4 7 9 0 5 5 8 5 13 0 5-5 8-12 8S8 32 8 27c0-5 5-8 5-13 0-5 2-9 7-9Z" />,
  wide: <path d="M5 15c0-6 7-8 15-8s15 2 15 8v9c0 7-7 10-15 10S5 31 5 24Z" />,
};
export function FaceIcon({ id, size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      {FACE[id]}
    </svg>
  );
}

// ── 基础小组件 ─────────────────────────────────────────
export function Seg({ options, value, onChange, block = false, label }) {
  return (
    <div className={`seg${block ? " seg-block" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" className={value === o.id ? "on" : ""}
          aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Chip({ on, onClick, children, small = false, className = "" }) {
  return (
    <button type="button" aria-pressed={!!on} onClick={onClick}
      className={`chip${small ? " chip-s" : ""}${on ? " on" : ""} ${className}`}>{children}</button>
  );
}

export function Toggle({ on, onClick, children }) {
  return (
    <button type="button" aria-pressed={!!on} onClick={onClick} className={`chip toggle${on ? " on" : ""}`}>
      <span className="tick">{on && <Icon name="check" size={11} stroke={2.6} />}</span>
      {children}
    </button>
  );
}

// 表单行：左侧标题 + 说明，右侧控件
export function Sec({ title, hint, children }) {
  return (
    <section className="sec">
      <div className="sec-h"><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
      <div className="stack">{children}</div>
    </section>
  );
}

// 文字颜色：在给定背景色上选黑或白
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#14171C";
  const n = parseInt(m[1], 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  return L > 0.4 ? "#14171C" : "#FFFFFF";
}

export function useToggleSet() {
  const [set, setSet] = useState(new Set());
  const toggle = (id) => setSet((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSet(new Set());
  return [set, toggle, clear];
}
