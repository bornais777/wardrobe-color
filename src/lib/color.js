// ═══════════════════════════════════════════════════════
// 色彩工具
// ═══════════════════════════════════════════════════════
export function toHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s));
  l = Math.max(0, Math.min(100, l));
  const s1 = s / 100, l1 = l / 100;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  } else s = 0;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}

// canvas提取主色（k-means简化版：取饱和度最高的前N个聚类）
export function extractMainColors(imgEl, count = 6) {
  const canvas = document.createElement("canvas");
  const SIZE = 80;
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const buckets = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a < 128) continue;
    // 量化到16步
    const qr = Math.round(r / 16) * 16;
    const qg = Math.round(g / 16) * 16;
    const qb = Math.round(b / 16) * 16;
    const key = `${qr},${qg},${qb}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  const sorted = Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([key, cnt]) => {
      const [r, g, b] = key.split(",").map(Number);
      const hsl = rgbToHsl(r, g, b);
      return { r, g, b, hex: toHex(hsl.h, hsl.s, hsl.l), hsl, cnt };
    })
    // 过滤极端黑白灰，优先有色彩的
    .filter(c => c.hsl.s > 8 || c.cnt > 200)
    .sort((a, b) => (b.hsl.s * 0.6 + b.cnt * 0.001) - (a.hsl.s * 0.6 + a.cnt * 0.001));
  // 去重（色相差距太小的合并）
  const result = [];
  for (const c of sorted) {
    if (result.length >= count) break;
    const tooClose = result.some(r => Math.abs(r.hsl.h - c.hsl.h) < 20 && Math.abs(r.hsl.l - c.hsl.l) < 15);
    if (!tooClose) result.push(c);
  }
  // 不够就补灰
  if (result.length < 2) {
    const grays = Object.entries(buckets).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>{
      const [r,g,b]=k.split(",").map(Number); const hsl=rgbToHsl(r,g,b);
      return {r,g,b,hex:toHex(hsl.h,hsl.s,hsl.l),hsl};
    });
    for(const g of grays){ if(result.length>=count) break; result.push(g); }
  }
  return result;
}

// ═══════════════════════════════════════════════════════
// 配色方案计算
// ═══════════════════════════════════════════════════════
export const SKIN_TONES = [
  { id:"cool_light", label:"冷白", hex:"#F5EEE8", isWarm:false },
  { id:"neutral_light", label:"自然白", hex:"#F0E0C8", isWarm:false },
  { id:"warm_yellow", label:"暖黄", hex:"#D4A96A", isWarm:true },
  { id:"warm_deep", label:"暖深", hex:"#B07D4A", isWarm:true },
  { id:"olive", label:"橄榄", hex:"#9A8060", isWarm:true },
];

// 测试用预设衣物色卡（模拟从不同衣服图片提取的主色）
export const TEST_OUTFITS = [
  { name:"雾霾蓝风衣", colors:[
    { hex:"#7A9AB5", hsl:{h:207,s:28,l:59} },
    { hex:"#C8C0B4", hsl:{h:35,s:12,l:75} },
    { hex:"#3D5A70", hsl:{h:207,s:30,l:34} },
    { hex:"#E8E4DC", hsl:{h:40,s:18,l:88} },
    { hex:"#8A7D6E", hsl:{h:32,s:13,l:49} },
  ]},
  { name:"砖红毛衣", colors:[
    { hex:"#C8624A", hsl:{h:12,s:52,l:54} },
    { hex:"#8B4A38", hsl:{h:12,s:42,l:38} },
    { hex:"#E8D4C8", hsl:{h:20,s:40,l:85} },
    { hex:"#5A3028", hsl:{h:10,s:38,l:25} },
    { hex:"#D4A090", hsl:{h:12,s:35,l:69} },
  ]},
  { name:"薰衣草长裙", colors:[
    { hex:"#A090C8", hsl:{h:255,s:32,l:67} },
    { hex:"#C8B8E8", hsl:{h:265,s:45,l:81} },
    { hex:"#6A5A90", hsl:{h:258,s:28,l:46} },
    { hex:"#E8E4F0", hsl:{h:260,s:30,l:92} },
    { hex:"#807098", hsl:{h:262,s:18,l:52} },
  ]},
  { name:"墨绿外套", colors:[
    { hex:"#4A6B58", hsl:{h:147,s:18,l:36} },
    { hex:"#2E4A38", hsl:{h:145,s:24,l:24} },
    { hex:"#7A9880", hsl:{h:138,s:14,l:54} },
    { hex:"#C8D4C0", hsl:{h:105,s:14,l:80} },
    { hex:"#1A2E22", hsl:{h:144,s:28,l:14} },
  ]},
  { name:"米驼大衣", colors:[
    { hex:"#C8B090", hsl:{h:33,s:32,l:68} },
    { hex:"#A89070", hsl:{h:33,s:26,l:55} },
    { hex:"#E8DCC8", hsl:{h:38,s:35,l:85} },
    { hex:"#786050", hsl:{h:24,s:22,l:40} },
    { hex:"#F0E8D8", hsl:{h:38,s:42,l:90} },
  ]},
];

export function matchSchemes(mainColor, skinTone) {
  const { h, s, l } = mainColor;
  const isWarmSkin = skinTone.isWarm;
  const analogH1 = (h + 30) % 360;
  const compH = (h + 180) % 360;
  const nearCompH1 = (h + 150) % 360;
  const accentContrastH = isWarmSkin ? nearCompH1 : compH;
  return [
    { id:"A", name:"A · 色阶压缩", desc:"无彩色画布，容错最高，所有肤色友好。", warning:null,
      colors:[{hex:skinTone.hex,label:"肤色",size:"lg"},{hex:toHex(h,s,l),label:"主色",size:"md"},
              {hex:"#1a1a1a",label:"黑",size:"md"},{hex:"#888",label:"中灰",size:"sm"},{hex:"#f0f0f0",label:"近白",size:"sm"}]},
    { id:"B", name:"B · 临近色+点缀", desc:"大面积低饱和临近色，小面积高饱和点缀。", warning:null,
      colors:[{hex:skinTone.hex,label:"肤色",size:"lg"},{hex:toHex(h,s,l),label:"主色",size:"md"},
              {hex:toHex(analogH1,Math.max(s-15,8),Math.min(l+8,85)),label:"临近低饱",size:"md"},
              {hex:toHex(analogH1,Math.min(s+30,88),Math.max(l-8,35)),label:"点缀①",size:"sm"},
              {hex:toHex(accentContrastH,Math.min(s+30,85),45),label:"点缀②",size:"sm"}]},
    { id:"C", name:"C · 对比双低饱和", desc:"两色压低饱和带灰调碰撞，张力不躁。",
      warning:isWarmSkin?"脸周围选偏暖侧，避免冷色对冲":null,
      colors:[{hex:skinTone.hex,label:"肤色",size:"lg"},{hex:toHex(h,s,l),label:"主色",size:"md"},
              {hex:toHex(h,Math.min(s,25),l),label:"同色低饱参考",size:"sm",isRef:true},
              {hex:toHex(nearCompH1,20,55),label:"对比低饱",size:"md"},{hex:"#c8c8c8",label:"灰压",size:"sm"}]},
    { id:"D", name:"D · 临近互补微调", desc:"互补色偏移30°，张力可控。", warning:null,
      colors:[{hex:skinTone.hex,label:"肤色",size:"lg"},{hex:toHex(h,s,l),label:"主色",size:"md"},
              {hex:toHex(nearCompH1,Math.min(s+8,52),Math.max(l-5,30)),label:"临近互补",size:"md"},
              {hex:toHex((nearCompH1+25)%360,15,72),label:"过渡缓冲",size:"sm"}]},
    { id:"E", name:"E · 高饱和对撞", desc:"两高饱和对比色并置，冲击力最强。",
      warning:isWarmSkin?"⚠ 暖/黄皮慎用，建议退回方案C":"冷白/中性肤色可尝试，主色面积占优",
      colors:[{hex:skinTone.hex,label:"肤色",size:"lg"},{hex:toHex(h,s,l),label:"主色",size:"md"},
              {hex:toHex(h,Math.min(s+25,95),l),label:"拉高饱参考",size:"sm",isRef:true},
              {hex:toHex(compH,75,45),label:"互补高饱",size:"md"}]},
  ];
}

// 配色方案→结构化色块文本（直接给AI看，不再抽象）
export function schemeToStructuredText(scheme, skinTone) {
  const HUE_NAMES = [
    [15,"red"],[45,"orange"],[75,"yellow"],[105,"yellow-green"],
    [135,"green"],[165,"teal"],[195,"cyan"],[225,"blue"],
    [255,"blue-violet"],[285,"violet"],[315,"pink"],[345,"rose"],[360,"red"]
  ];
  const hueName = (h) => HUE_NAMES.find(([deg]) => ((h%360+360)%360) <= deg)?.[1] || "neutral";
  const lightName = (l) => l > 75 ? "light" : l > 45 ? "medium" : "dark";
  const satName = (s) => s > 60 ? "vivid" : s > 25 ? "muted" : "pale/desaturated";

  const colorDesc = (c) => {
    const isRef = c.isRef;
    const role = c.size === "lg" ? "skin tone reference" :
                 c.size === "md" ? (c.label.includes("主") ? "main color (largest area)" : "secondary color (medium area)") :
                 "accent/detail color (small area)";
    const rgb = { r: parseInt(c.hex.slice(1,3),16), g: parseInt(c.hex.slice(3,5),16), b: parseInt(c.hex.slice(5,7),16) };
    const hsl = (() => {
      let r=rgb.r/255,g=rgb.g/255,b=rgb.b/255;
      const max=Math.max(r,g,b),min=Math.min(r,g,b);
      let h=0,s,l=(max+min)/2;
      if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
        switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}
      else s=0;
      return {h:Math.round(h*360),s:Math.round(s*100),l:Math.round(l*100)};
    })();
    return `  - ${c.label}（${role}）: ${c.hex}, ${lightName(hsl.l)} ${satName(hsl.s)} ${hueName(hsl.h)}${isRef?" [参考色，可购入方向]":""}`;
  };

  if (!skinTone) skinTone = { hex:"#F0E0C8", label:"自然白", isWarm:false };
  const schemeStyle = {
    A: "无彩色系，强调廓形与质感，任何肤色友好",
    B: "临近色调和，主色+低饱临近+高饱小点缀，层次丰富",
    C: "对比色双低饱和，灰调碰撞，高级故事感",
    D: "临近互补微调，有对比感但不强烈，张力可控",
    E: "高饱和直接对撞，视觉冲击强，对肤色要求高",
  };

  return `配色方案：${scheme.name}
方案逻辑：${schemeStyle[scheme.id]||""}
${scheme.warning ? `注意：${scheme.warning}` : ""}
肤色：${skinTone.hex}（${skinTone.label}，${skinTone.isWarm?"暖色系":"冷/中性"}）

色块分配：\n${scheme.colors.map(colorDesc).join("\n")}`;
}


export function makeColor(hex) {
  const h = hex.toLowerCase();
  const { r, g, b } = hexToRgb(h);
  return { hex: h, hsl: rgbToHsl(r, g, b), r, g, b, cnt: 100 };
}
export function hslToColorName(h, s, l) {
  if (s < 12) return l > 70 ? "light gray" : l > 40 ? "gray" : "dark gray";
  if (l > 85) return "off-white";
  if (l < 20) return "near-black";
  const names = [[15,"red"],[40,"orange"],[65,"yellow"],[80,"yellow-green"],
    [150,"green"],[175,"teal"],[200,"sky blue"],[240,"blue"],[270,"purple"],
    [300,"violet"],[330,"pink"],[360,"red"]];
  const hue = names.find(([deg]) => h <= deg)?.[1] || "neutral";
  const lt = l > 70 ? "light " : l < 35 ? "dark " : "";
  const sat = s < 30 ? "muted " : s > 70 ? "vivid " : "";
  return `${lt}${sat}${hue}`.trim();
}
export function colorNameOf(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToColorName(h, s, l);
}


// ═══════════════════════════════════════════════════════
// 界面强调色：整个界面跟着所选衣色变化，并保证文字/描边可读
// ═══════════════════════════════════════════════════════
export function cnColorName({ h, s, l }) {
  if (l >= 92) return "近白";
  if (l <= 12) return "近黑";
  if (s < 10) return l > 70 ? "浅灰" : l > 40 ? "灰" : "深灰";
  const hues = [[15,"红"],[40,"橙"],[65,"黄"],[80,"黄绿"],[150,"绿"],[175,"青绿"],[200,"青"],
    [250,"蓝"],[285,"紫"],[330,"粉紫"],[345,"玫红"],[360,"红"]];
  const hn = hues.find(([d]) => h <= d)[1];
  return `${l > 78 ? "浅" : l < 30 ? "深" : ""}${s < 25 ? "灰" : ""}${hn}`;
}

function lum(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mix(hex, toward, t) {
  const a = hexToRgb(hex), b = hexToRgb(toward);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(a.r, b.r)}${c(a.g, b.g)}${c(a.b, b.b)}`;
}
// 把颜色朝黑（浅底）或朝白（深底）推，直到与 bg 的对比度 ≥ target
export function ensureContrast(hex, bg, target, toward) {
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const c = mix(hex, toward, t);
    if (contrast(c, bg) >= target) return c;
  }
  return toward;
}

const DEFAULT_ACCENT = "#3A4A7A";
export function applyAccent(hex) {
  const base = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const root = document.documentElement.style;
  root.setProperty("--accent", base);
  root.setProperty("--accent-lt", ensureContrast(base, "#FFFFFF", 4.5, "#000000"));
  root.setProperty("--accent-dk", ensureContrast(base, "#171A1F", 4.5, "#FFFFFF"));
}
