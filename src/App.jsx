import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { PALETTE_SERIES } from "./palette.js";
import { GENDERS, SEASONS, SEASON_EN, FACE_SHAPES, buildAnalysisPrompt } from "./prompts.js";

// ═══════════════════════════════════════════════════════
// 设计 token
// ═══════════════════════════════════════════════════════
const T = {
  bg: "#F7F5F2", surface: "#FAFAF8", surface2: "#F2F0EC",
  border: "#E8E5E0", borderLight: "#F0EDE8",
  text: "#1A1A1A", textSub: "#666", textMuted: "#AAA",
  accent: "#1A1A1A", accentSoft: "#EDEBE7",
  warn: "#B85C38", warnBg: "#FDF0EB",
  radius: "12px", radiusSm: "8px", radiusXs: "6px",
  shadow: "0 1px 4px rgba(0,0,0,0.07)",
  shadowMd: "0 4px 16px rgba(0,0,0,0.10)",
};

// ═══════════════════════════════════════════════════════
// 统一 LLM 调用（支持 Anthropic 原生 + OpenAI 兼容接口）
// 可配：温度 / token 上限 / 流式输出（设置页 → 文字 AI）
// ═══════════════════════════════════════════════════════
const numOrUndef = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));

// 逐行读取 SSE：每个 data: {...} 回调一次
async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { onEvent(JSON.parse(payload)); } catch {}
    }
  }
}

// Gemini 等兼容接口对 system role 支持不稳，把 system 合并进第一条 user 消息更可靠
function mergeSystemIntoFirstUser(system, messages) {
  const msgs = messages.map((m) => ({ ...m }));
  if (!system) return msgs;
  const i = msgs.findIndex((m) => m.role === "user");
  if (i < 0) return [{ role: "system", content: system }, ...msgs];
  const c = msgs[i].content;
  if (typeof c === "string") {
    msgs[i].content = `${system}\n\n---\n${c}`;
  } else {
    let merged = false;
    msgs[i].content = c.map((p) => {
      if (!merged && p.type === "text") { merged = true; return { ...p, text: `${system}\n\n---\n${p.text}` }; }
      return p;
    });
  }
  return msgs;
}

async function requestLLM({ settings, system, messages, maxTokens = 1000, onDelta = null }) {
  const mode = settings.llmMode || "anthropic";
  const model = settings.llmModel || "claude-sonnet-4-6";
  const temperature = numOrUndef(settings.llmTemperature);
  const cap = numOrUndef(settings.llmMaxTokens);
  const mt = cap && cap > 0 ? cap : maxTokens;
  const stream = !!settings.llmStream;

  if (mode === "openai") {
    const baseUrl = (settings.llmBaseUrl || "https://api.openai.com").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    const apiKey = settings.llmApiKey || "";
    const body = {
      model, max_tokens: mt,
      messages: mergeSystemIntoFirstUser(system, messages),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(stream ? { stream: true } : {}),
    };
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`文字API HTTP ${resp.status} ${t.slice(0, 120)}`);
    }
    if (stream && resp.body) {
      let acc = "";
      await readSSE(resp, (ev) => {
        const d = ev.choices?.[0]?.delta?.content;
        if (d) { acc += d; onDelta?.(acc); }
      });
      return acc;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";
  }

  // Anthropic 原生格式（支持 vision）
  const body = {
    model, max_tokens: mt,
    ...(system ? { system } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(stream ? { stream: true } : {}),
    messages,
  };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`文字API HTTP ${resp.status} ${t.slice(0, 120)}`);
  }
  if (stream && resp.body) {
    let acc = "";
    await readSSE(resp, (ev) => {
      if (ev.type === "content_block_delta" && ev.delta?.text) { acc += ev.delta.text; onDelta?.(acc); }
    });
    return acc;
  }
  const data = await resp.json();
  return data.content?.[0]?.text || "";
}

async function callLLM({ settings, system, userContent, maxTokens = 1000, imageBase64 = null, imageMime = "image/jpeg", onDelta = null }) {
  const mode = settings.llmMode || "anthropic";
  let content = userContent;
  if (imageBase64) {
    content = mode === "openai"
      ? [
          { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
          { type: "text", text: userContent },
        ]
      : [
          { type: "image", source: { type: "base64", media_type: imageMime, data: imageBase64 } },
          { type: "text", text: userContent },
        ];
  }
  return requestLLM({ settings, system, messages: [{ role: "user", content }], maxTokens, onDelta });
}

// 多轮对话版（对话弹窗用，需要传完整历史）
async function callLLMChat({ settings, system, messages, maxTokens = 1000 }) {
  return requestLLM({ settings, system, messages, maxTokens });
}

// ═══════════════════════════════════════════════════════
// 色彩工具
// ═══════════════════════════════════════════════════════
function toHex(h, s, l) {
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
function rgbToHsl(r, g, b) {
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
function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}

// canvas提取主色（k-means简化版：取饱和度最高的前N个聚类）
function extractMainColors(imgEl, count = 6) {
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
const SKIN_TONES = [
  { id:"cool_light", label:"冷白", hex:"#F5EEE8", isWarm:false },
  { id:"neutral_light", label:"自然白", hex:"#F0E0C8", isWarm:false },
  { id:"warm_yellow", label:"暖黄", hex:"#D4A96A", isWarm:true },
  { id:"warm_deep", label:"暖深", hex:"#B07D4A", isWarm:true },
  { id:"olive", label:"橄榄", hex:"#9A8060", isWarm:true },
];

// 测试用预设衣物色卡（模拟从不同衣服图片提取的主色）
const TEST_OUTFITS = [
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

function matchSchemes(mainColor, skinTone) {
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
function schemeToStructuredText(scheme, skinTone) {
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

// ═══════════════════════════════════════════════════════
// 小组件
// ═══════════════════════════════════════════════════════
function ColorSwatch({ hex, label, size="md", isRef=false, onClick, selected }) {
  const px = { lg:48, md:36, sm:26 };
  return (
    <div onClick={onClick} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
      cursor:onClick?"pointer":"default" }}>
      <div style={{
        width:px[size], height:px[size], borderRadius:"7px",
        backgroundColor:hex,
        border:selected ? `2px solid ${T.accent}` : isRef ? "1.5px dashed rgba(0,0,0,0.25)" : "1px solid rgba(0,0,0,0.08)",
        boxShadow:selected ? `0 0 0 2px ${T.accent}40` : isRef ? "none" : T.shadow,
        opacity:isRef ? 0.75 : 1, flexShrink:0,
        transition:"all 0.15s",
      }}/>
      <span style={{ fontSize:"8px", color:isRef?T.textMuted:T.textSub, textAlign:"center",
        maxWidth:"52px", lineHeight:1.2, fontStyle:isRef?"italic":"normal" }}>{label}</span>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant="primary", style:s={} }) {
  const styles = {
    primary: { bg: disabled ? T.border : T.accent, color: disabled ? T.textMuted : "#fff" },
    ghost:   { bg: "transparent", color: T.textSub, border:`1px solid ${T.border}` },
    soft:    { bg: T.accentSoft, color: T.text },
    danger:  { bg: "#fee2e2", color: "#b91c1c" },
  };
  const st = styles[variant] || styles.primary;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding:"9px 14px", borderRadius:T.radiusSm, border:st.border||"none",
      backgroundColor:st.bg, color:st.color, fontSize:"12px", fontWeight:"500",
      cursor:disabled?"not-allowed":"pointer", transition:"all 0.15s",
      letterSpacing:"0.03em", ...s,
    }}>{children}</button>
  );
}

function SectionLabel({ children }) {
  return <p style={{ fontSize:"10px", color:T.textMuted, margin:"0 0 8px", letterSpacing:"0.06em" }}>{children}</p>;
}

// ═══════════════════════════════════════════════════════
// 对话弹窗
// ═══════════════════════════════════════════════════════
function ChatModal({ imageItem, onClose, settings, onUpdateMemory, messages, setMessages }) {
  // messages/setMessages由外部传入，关闭再打开历史不丢
  const msgs = messages;
  const setMsgs = setMessages;
  // 首次打开时若为空则加初始消息
  useEffect(() => {
    if (msgs.length === 0) {
      setMsgs([{
        role:"assistant",
        content: settings.charCard
          ? "这套搭配方案出来了，我来帮你看看。"
          : "这套搭配出来了，你觉得怎么样？",
      }]);
    }
  }, []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const send = async () => {
    const text = input.trim(); if (!text || loading) return;
    const next = [...msgs, { role:"user", content:text }];
    setMsgs(next); setInput(""); setLoading(true);
    try {
      const sys = settings.charCard
        ? `你是穿搭顾问角色。设定：${settings.charCard}\n偏好记忆：${settings.memory||"无"}\n针对当前AI生成的穿搭方案给出具体建议，不要泛泛而谈。`
        : `你是有审美品位的穿搭顾问。偏好记忆：${settings.memory||"无"}\n给出具体、有观点的建议。`;
      const reply = await callLLMChat({
        settings,
        system: sys,
        messages: next.map(m=>({role:m.role,content:m.content})),
        maxTokens: 1000,
      });
      setMsgs(p=>[...p,{role:"assistant",content:reply||"（无回复）"}]);
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"连接失败，请检查API配置。"}]); }
    setLoading(false);
  };

  const summarizePrefs = async () => {
    if (loading || msgs.length < 3) return;
    setLoading(true);
    try {
      const convText = msgs.map(m=>`${m.role==="user"?"用户":"助手"}：${m.content}`).join("\n");
      const newPrefs = (await callLLM({
        settings,
        system: `从对话中提取用户的穿搭偏好信息。规则：只提取明确表达的偏好，不要推断。格式：每条一行，以「喜欢」「不喜欢」「倾向」「避免」开头。最多8条，每条15字以内。只输出偏好列表，不要其他内容。`,
        userContent: `对话记录：
${convText}

提取穿搭偏好：`,
        maxTokens: 300,
      })).trim() || "";
      if (newPrefs && onUpdateMemory) {
        const existing = settings.memory ? settings.memory.trim() : "";
        const merged = existing ? existing + "\n" + newPrefs : newPrefs;
        onUpdateMemory(merged);
        setMsgs(p=>[...p,{role:"assistant",
          content:`✓ 已总结以下偏好写入记忆：
${newPrefs}`}]);
      }
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"总结失败，请检查API配置。"}]); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:200,backgroundColor:"rgba(0,0,0,0.5)",
      display:"flex",alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ width:"100%",maxWidth:"480px",margin:"0 auto",
        backgroundColor:T.surface,borderRadius:"20px 20px 0 0",
        maxHeight:"75vh",display:"flex",flexDirection:"column",
        boxShadow:"0 -4px 32px rgba(0,0,0,0.15)" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"center",padding:"12px 0 4px" }}>
          <div style={{ width:"36px",height:"4px",borderRadius:"2px",backgroundColor:T.border }}/>
        </div>
        {imageItem && (
          <div style={{ padding:"0 16px 10px",display:"flex",alignItems:"center",gap:"10px",
            borderBottom:`1px solid ${T.border}` }}>
            <div style={{ width:"40px",height:"40px",borderRadius:"8px",flexShrink:0,
              backgroundColor:imageItem.color||"#ccc",border:`1px solid ${T.border}`,
              backgroundImage:imageItem.dataUrl?`url(${imageItem.dataUrl})`:"none",
              backgroundSize:"cover",backgroundPosition:"center" }}/>
            <div style={{ flex:1 }}>
              <p style={{ fontSize:"11px",fontWeight:"600",color:T.text,margin:0 }}>当前搭配</p>
              <p style={{ fontSize:"10px",color:T.textMuted,margin:"1px 0 0",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"200px" }}>
                {imageItem.prompt?.slice(0,40)||"生成图"}
              </p>
            </div>
            <button onClick={onClose} style={{ background:"none",border:"none",color:T.textMuted,
              fontSize:"20px",cursor:"pointer",padding:"4px",lineHeight:1 }}>×</button>
          </div>
        )}
        <div style={{ flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",
          flexDirection:"column",gap:"10px" }}>
          {msgs.map((m,i)=>(
            <div key={i} style={{ display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
              <div style={{ maxWidth:"80%",backgroundColor:m.role==="user"?T.accent:T.accentSoft,
                color:m.role==="user"?"#fff":T.text,
                borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",
                padding:"9px 13px",fontSize:"12px",lineHeight:"1.6" }}>{m.content}</div>
            </div>
          ))}
          {loading && <div style={{ display:"flex" }}><div style={{ backgroundColor:T.accentSoft,
            borderRadius:"14px 14px 14px 4px",padding:"9px 13px",fontSize:"12px",color:T.textMuted }}>
            思考中…</div></div>}
          <div ref={bottomRef}/>
        </div>
        <div style={{ padding:"8px 16px 0",borderTop:`1px solid ${T.border}` }}>
          {/* 总结偏好按钮 */}
          <button onClick={summarizePrefs} disabled={loading||msgs.length<3} style={{
            width:"100%",padding:"7px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,
            backgroundColor:T.bg,fontSize:"11px",color:msgs.length<3?T.textMuted:T.textSub,
            cursor:msgs.length<3?"default":"pointer",marginBottom:"8px",
          }}>
            ✦ 总结偏好写入记忆
          </button>
        </div>
        <div style={{ padding:"0 16px 16px",display:"flex",gap:"8px" }}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
            placeholder="说点什么…"
            style={{ flex:1,padding:"9px 12px",borderRadius:"20px",
              border:`1px solid ${T.border}`,backgroundColor:T.bg,
              fontSize:"12px",color:T.text,outline:"none" }}/>
          <button onClick={send} disabled={!input.trim()||loading} style={{
            padding:"9px 16px",borderRadius:"20px",border:"none",
            backgroundColor:input.trim()?T.accent:T.border,
            color:input.trim()?"#fff":T.textMuted,
            fontSize:"12px",cursor:input.trim()?"pointer":"default" }}>发送</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 搭配页（首页：所有选项并列、选填，结果就地生成，不再跳页）
// ═══════════════════════════════════════════════════════
const inputStyle = {
  width:"100%", padding:"9px 11px", borderRadius:T.radiusSm,
  border:`1px solid ${T.border}`, backgroundColor:T.bg,
  fontSize:"11px", color:T.text, outline:"none", boxSizing:"border-box",
};
const DEFAULT_SKIN = SKIN_TONES[1];
const BACKEND_KEY = "wardrobe_backend_v1";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeColor(hex) {
  const h = hex.toLowerCase();
  const { r, g, b } = hexToRgb(h);
  return { hex: h, hsl: rgbToHsl(r, g, b), r, g, b, cnt: 100 };
}
function hslToColorName(h, s, l) {
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
function colorNameOf(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToColorName(h, s, l);
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding:"6px 12px", borderRadius:"16px", cursor:"pointer", fontSize:"11px",
      border:`1px solid ${active ? T.accent : T.border}`,
      backgroundColor:active ? T.accent : T.surface,
      color:active ? "#fff" : T.textSub, transition:"all 0.15s",
    }}>{children}</button>
  );
}
function ToggleChip({ on, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:"6px", padding:"6px 11px",
      borderRadius:"16px", cursor:"pointer", fontSize:"11px",
      border:`1px solid ${on ? T.accent : T.border}`,
      backgroundColor:on ? "#fff" : T.surface,
      color:on ? T.text : T.textMuted, transition:"all 0.15s",
    }}>
      <span style={{ width:"10px", height:"10px", borderRadius:"50%", flexShrink:0,
        border:`1.5px solid ${on ? T.accent : T.textMuted}`,
        backgroundColor:on ? T.accent : "transparent" }}/>
      {children}
    </button>
  );
}

function GeneratePage({ settings, onSaveToWardrobe, onUpdateMemory, onAddMaterial, chatMessages, setChatMessages, homeSignal }) {
  // ── 输入（全部并列、选填）──
  const [uploadedImg, setUploadedImg] = useState(null);       // {url,name} | {url:null,mockName}
  const [extractedColors, setExtractedColors] = useState([]);
  const [selectedColor, setSelectedColor] = useState(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [hexInput, setHexInput] = useState("");
  const [selectedSkin, setSelectedSkin] = useState(null);
  const [garments, setGarments] = useState([{ id:1, name:"", color:"" }]);
  const [season, setSeason] = useState(null);
  const [gender, setGender] = useState("f");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [faceId, setFaceId] = useState(null);
  const [nlDesc, setNlDesc] = useState("");
  const [schemeId, setSchemeId] = useState("A");
  const [toggles, setToggles] = useState({});                 // 手动勾选覆盖：undefined=自动
  const [backend, setBackend] = useState(() => {
    try { return localStorage.getItem(BACKEND_KEY) === "gpt" ? "gpt" : "nai"; } catch { return "nai"; }
  });

  // ── 输出 / 过程 ──
  const [analysis, setAnalysis] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState("");
  const [resultImg, setResultImg] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState("");
  const fileRef = useRef(null);
  const resultRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(BACKEND_KEY, backend); } catch {} }, [backend]);

  // 点击顶部图标回到首页顶部
  useEffect(() => {
    if (homeSignal) scrollRef.current?.scrollTo({ top:0, behavior:"smooth" });
  }, [homeSignal]);

  // 生图成功后自动滚到结果区
  useEffect(() => {
    if (resultImg && resultRef.current) resultRef.current.scrollIntoView({ behavior:"smooth", block:"start" });
  }, [resultImg]);

  // ── 派生：配色方案随主色/肤色实时计算，不再需要"分析"这一步 ──
  const schemes = useMemo(
    () => (selectedColor ? matchSchemes(selectedColor.hsl, selectedSkin || DEFAULT_SKIN) : []),
    [selectedColor, selectedSkin]
  );
  const selectedScheme = schemes.find(s => s.id === schemeId) || schemes[0] || null;

  // ── 勾选逻辑 ──
  // 已手动填写 → 默认勾选；未填写 → 需手动勾选（有图片时按图片判断）；发型默认不勾选
  const filled = {
    garment: garments.some(g => g.name.trim()),
    season: !!season,
    body: Number(height) > 0 || Number(weight) > 0,
    face: !!faceId,
    hair: false,
  };
  const isOn = (k) => toggles[k] ?? filled[k];
  const flip = (k) => setToggles(t => ({ ...t, [k]: !isOn(k) }));
  const clearToggle = (k) => setToggles(t => { if (!(k in t)) return t; const n = { ...t }; delete n[k]; return n; });

  const hasRealImage = !!uploadedImg?.url;
  const FIELD_KEYS = [
    { key:"garment", label:"款式" }, { key:"season", label:"季节" },
    { key:"body", label:"身高体重" }, { key:"face", label:"脸型" }, { key:"hair", label:"发型" },
  ];
  const toggleNotes = FIELD_KEYS.filter(f => isOn(f.key) && !filled[f.key]).map(f =>
    f.key === "hair" ? "发型：按脸型 / 身高 / 体型推导（不看原图发型）"
      : hasRealImage ? `${f.label}：未填写，按图片判断`
      : `${f.label}：未填写且无图片，将忽略`);

  const canGenerate = !!selectedColor || filled.garment || filled.season || filled.body || filled.face || !!nlDesc.trim();

  // ── 输入处理 ──
  const handleUpload = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const colors = extractMainColors(img, 6);
      setUploadedImg({ url, el:img, name:file.name });
      setExtractedColors(colors);
      setSelectedColor(colors[0] || null);
      setResultImg(null);
      if (onAddMaterial) onAddMaterial({ id:Date.now(), dataUrl:url, name:file.name,
        savedAt:new Date().toLocaleString("zh-CN") });
    };
    img.src = url;
    e.target.value = "";
  };

  // 测试模式：载入预设色卡，跳过文件上传
  const handleLoadTestOutfit = (outfit) => {
    const colors = outfit.colors.map(c => {
      const l = typeof c.hsl.l === "string" ? parseInt(c.hsl.l) : c.hsl.l;
      const hex = toHex(c.hsl.h, c.hsl.s, l);
      return { hex, hsl:{ h:c.hsl.h, s:c.hsl.s, l }, ...hexToRgb(hex), cnt:100 };
    });
    setUploadedImg({ url:null, mockName:outfit.name });
    setExtractedColors(colors);
    setSelectedColor(colors[0]);
    setResultImg(null);
  };

  const updateGarment = (id, patch) => setGarments(gs => gs.map(g => g.id === id ? { ...g, ...patch } : g));
  const addGarment = () => setGarments(gs => [...gs, { id:Date.now(), name:"", color:"" }]);
  const removeGarment = (id) => setGarments(gs => gs.length > 1 ? gs.filter(g => g.id !== id) : [{ id, name:"", color:"" }]);

  const pickHex = (v) => {
    setHexInput(v);
    const m = /^#?([0-9a-fA-F]{6})$/.exec(v.trim());
    if (m) setSelectedColor(makeColor("#" + m[1]));
  };

  const reset = () => {
    setUploadedImg(null); setExtractedColors([]); setSelectedColor(null);
    setSelectedSkin(null); setGarments([{ id:1, name:"", color:"" }]);
    setSeason(null); setGender("f"); setHeight(""); setWeight(""); setFaceId(null);
    setNlDesc(""); setToggles({}); setAnalysis(""); setResultImg(null); setHexInput("");
  };

  // ── 生成：搭配分析 → 组装 prompt ──
  const imageToBase64 = async () => {
    if (!uploadedImg?.url) return { b64:null, mime:"image/jpeg" };
    try {
      const blob = await (await fetch(uploadedImg.url)).blob();
      const b64 = await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result.split(",")[1]);
        fr.readAsDataURL(blob);
      });
      return { b64, mime: blob.type || "image/jpeg" };
    } catch { return { b64:null, mime:"image/jpeg" }; }
  };

  // kind: "tag" → NAI tag 串；"nl" → 给 GPT 的英文自然语言描述
  const buildPrompt = async (kind) => {
    const artistPre = settings.artistPresets?.find(p => p.id === settings.activePreset);
    const artistTags = kind === "tag" && artistPre ? artistPre.tags : "";
    const negTags = kind === "tag" ? (settings.negative || "") : "";
    const { b64, mime } = await imageToBase64();

    const garmentItems = garments.filter(g => g.name.trim())
      .map(g => ({ name:g.name.trim(), colorName:g.color ? colorNameOf(g.color) : "" }));
    const seasonOn = isOn("season") && season;

    // ① 搭配分析（只有至少一个模块生效才调用）
    let analysisText = "";
    setAnalysis("");
    const ap = buildAnalysisPrompt({
      gender, height, weight, faceId, season, garments:garmentItems,
      enabled:{ garment:isOn("garment"), season:isOn("season"), body:isOn("body"), face:isOn("face"), hair:isOn("hair") },
      hasImage:!!b64, nl:nlDesc.trim(),
    });
    if (ap) {
      setGenProgress("分析搭配…");
      try {
        analysisText = (await callLLM({
          settings, system:ap.system, userContent:ap.user, maxTokens:1500,
          imageBase64:b64, imageMime:mime, onDelta:t => setAnalysis(t),
        })).trim();
        setAnalysis(analysisText);
      } catch (e) {
        console.warn("[分析失败]", e);
        setGenProgress("分析失败，改用基础配色组装…");
        await sleep(900);
      }
    }

    // ② 强制色块：有自填单品时由单品主导，否则按配色方案分配
    const scheme = selectedColor ? selectedScheme : null;
    const usable = scheme ? scheme.colors.filter(c => c.size !== "lg" && !c.isRef) : [];
    const palette = usable.map(c => colorNameOf(c.hex));
    const slots = ["top","pants","sneakers","bag","accessory"];
    const mandatoryArr = garmentItems.length ? []
      : usable.slice(0,5).map((c,i) => `${colorNameOf(c.hex)} ${slots[i] || "accessory"}`);

    const info = [
      mandatoryArr.length ? `Mandatory garments (${mandatoryArr.length} items — describe ALL of them, in order): ${mandatoryArr.join(", ")}` : "",
      garmentItems.length ? `User-specified garments (all must appear; translate names to English; keep the given colors): ${garmentItems.map(g => `${g.name}${g.colorName ? ` [color: ${g.colorName}]` : ""}`).join("; ")}` : "",
      palette.length ? `Overall color palette (main → accent): ${palette.join(", ")}` : "",
      `Gender: ${gender === "m" ? "male" : "female"}`,
      seasonOn ? `Season: ${SEASON_EN[season]}` : "",
      analysisText ? `Stylist analysis (turn its conclusions into visible details):\n${analysisText}` : "",
      nlDesc.trim() ? `User description (follow it): ${nlDesc.trim()}` : "",
      b64 ? "A reference image shows the main garment style — keep its silhouette, then expand the rest of the outfit." : "",
      `User style preference: ${settings.aestheticDesc || "casual everyday"}`,
    ].filter(Boolean).join("\n");

    setGenProgress("组装 prompt…");

    if (kind === "nl") {
      const sys = `You write prompts for a text-to-image model. Output ONLY one English paragraph (under 120 words) describing a full-body fashion photo of a single standing ${gender === "m" ? "man" : "woman"} on a plain light background, wearing the outfit.
Keep every given color wording exactly. Turn the analysis conclusions (hem length, waist position, neckline shape, fabric weight, hair shape if given) into concrete visible details. Do not contradict the user-specified garments. No markdown, no explanation, no fantasy or ancient costume.`;
      let text = "";
      try {
        text = (await callLLM({ settings, system:sys, userContent:`${info}\nWrite the image prompt now:`,
          maxTokens:500, imageBase64:b64, imageMime:mime })).trim();
      } catch (e) { console.warn("[NL prompt失败]", e); }
      if (!text) {
        text = `Full-body fashion photo of a ${gender === "m" ? "man" : "woman"} standing against a plain light background, wearing ${[...mandatoryArr, ...garmentItems.map(g => `${g.colorName} ${g.name}`.trim())].join(", ") || "an everyday outfit"}.`;
      }
      return { tag:text, negative:"" };
    }

    const sys = `You are a NovelAI fashion prompt writer.
Input: a stylist analysis (may be absent), MANDATORY "color + garment" tags, user-specified garments, season, and a free-text description.
Output ONLY one comma-separated English tag string describing the outfit to draw.
Rules:
- Keep every MANDATORY tag exactly as written, and add 2-4 extra tags for each garment: garment type, silhouette, material, one styling detail. Derive them from the analysis and the user's inputs — do not fall back on generic defaults.
- Every user-specified garment must appear (translate names to English tags, keep their given colors).
- Conclusions about hem length, waist position, neckline shape, fabric weight and season must be visible in the tags.
- If the analysis gives hair parameters (top volume, side volume, end point, line direction), convert them into concrete hair tags (length, volume, shape). Otherwise do not mention hair.
- No sentences, no markdown, no explanation. No fantasy, no gown, no ancient costume.`;

    let rawAiTags = "";
    try {
      rawAiTags = (await callLLM({ settings, system:sys, userContent:`${info}\nWrite the comma-separated tags now:`,
        maxTokens:800, imageBase64:b64, imageMime:mime })).trim();
    } catch (e) { console.warn("[tag生成失败]", e); }
    setGenProgress(rawAiTags ? `AI: ${rawAiTags.slice(0,80)}…` : "⚠️ AI返回为空（已用基础词兜底）");
    await sleep(900);

    // 确定性拼装：强制色块在最前，AI 只补充风格词；即使 AI 返回空也有可用 prompt
    const aiArr = rawAiTags.split(",").map(s => s.trim()).filter(Boolean);
    const baseTags = [gender === "m" ? "1boy" : "1girl", "full body", "standing", "white background",
      "fashion photography", "real clothing", "everyday wear", "street fashion"];
    const seen = new Set(); const merged = [];
    const pushTag = (t) => { const k = t.toLowerCase(); if (!t || seen.has(k)) return; seen.add(k); merged.push(t); };
    mandatoryArr.forEach(pushTag);
    aiArr.forEach(pushTag);
    baseTags.forEach(pushTag);
    const tag = [merged.join(", "), artistTags].filter(Boolean).join(", ");
    return { tag, negative:negTags };
  };

  // ── 生成：调用生图接口 ──
  const urlToDataUrl = async (url) => {
    const blob = await (await fetch(url)).blob();
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  };

  const runNai = async (tag, negative) => {
    const proxyUrl = (settings.naiProxyUrl || "").trim();
    if (!proxyUrl) throw new Error("请先在设置里填写 NAI 接口地址");
    const reqBody = {
      token: settings.naiToken,
      model: settings.naiModel || "nai-diffusion-4-5-full",
      sampler: settings.naiSampler || "k_dpmpp_2m",
      noise_schedule: settings.naiNoiseSchedule || "karras",
      cfg: settings.naiCfg || "0",
      scale: settings.naiScale || "5",
      steps: settings.naiSteps || "28",
      seed: -1, size: settings.naiSize || "竖图", stream: 1, nocache: 1,
      tag, negative,
      addition: { imageToImageBase64:null, vibeTransferList:[], multiRoleList:[], characterKeep:null },
    };
    // 返回的图片地址若是相对路径，需要补上接口站点前缀
    const base = proxyUrl.replace(/\/api\/generate.*$/, "").replace(/\/api$/, "");
    const resp = await fetch(proxyUrl, {
      method:"POST",
      headers:{ "Authorization":`Bearer ${settings.naiToken}`, "Content-Type":"application/json" },
      body:JSON.stringify(reqBody),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = ""; let imageUrl = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream:true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const l = line.trim(); if (!l) continue;
        try {
          const obj = JSON.parse(l);
          if (obj.status === "wait") setGenProgress(obj.data || "排队中…");
          if (obj.status === "success" && obj.url) imageUrl = obj.url.startsWith("http") ? obj.url : base + obj.url;
        } catch {}
      }
    }
    if (!imageUrl) throw new Error("未收到图片URL");
    setGenProgress("下载图片…");
    return urlToDataUrl(imageUrl);
  };

  const runGpt = async (prompt) => {
    const base = (settings.gptBaseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    if (!base) throw new Error("请先在设置里填写 GPT 接口地址");
    const resp = await fetch(`${base}/v1/images/generations`, {
      method:"POST",
      headers:{ "Authorization":`Bearer ${settings.gptApiKey}`, "Content-Type":"application/json" },
      body:JSON.stringify({ model:settings.gptModel || "gpt-image-1", prompt, size:settings.gptSize || "1024x1536", n:1 }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${t.slice(0,120)}`);
    }
    const data = await resp.json();
    const first = data.data?.[0];
    if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
    if (first?.url) { setGenProgress("下载图片…"); return urlToDataUrl(first.url); }
    throw new Error("未收到图片");
  };

  const handleGenerate = async (overrideTag = null) => {
    if (generating || (!overrideTag && !canGenerate)) return;
    setGenerating(true); setResultImg(null); setShowPromptEdit(false);
    setGenProgress(overrideTag ? "使用自定义prompt…" : "准备中…");
    const schemeName = selectedScheme?.name || "自定义";
    const colorHex = selectedColor?.hex || "#b8a99a";
    const noKey = backend === "gpt" ? !settings.gptApiKey : !settings.naiToken;

    // mock模式：无 Token/Key 时用占位渐变色块验证流程
    if (noKey) {
      await sleep(800);
      setGenProgress("（测试模式）生成占位图…");
      await sleep(600);
      const mockDataUrl = await new Promise(res => {
        const canvas = document.createElement("canvas");
        canvas.width = 416; canvas.height = 608;
        const ctx = canvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, 416, 608);
        grad.addColorStop(0, colorHex + "cc"); grad.addColorStop(1, colorHex + "44");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 416, 608);
        ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(80, 120, 256, 360);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.font = "14px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(backend === "gpt" ? "GPT 测试占位图" : "NAI 测试占位图", 208, 300);
        ctx.fillText(schemeName, 208, 320);
        res(canvas.toDataURL("image/png"));
      });
      const mockItem = { dataUrl:mockDataUrl, prompt:`[mock] ${schemeName}, ${colorHex}`, negative:"",
        schemeId:selectedScheme?.id || "", schemeName, color:colorHex, id:Date.now() };
      setResultImg(mockItem); onSaveToWardrobe(mockItem); setChatMessages([]);
      setGenerating(false);
      return;
    }

    try {
      let tag, negative;
      if (overrideTag) { tag = overrideTag; negative = backend === "gpt" ? "" : (settings.negative || ""); }
      else ({ tag, negative } = await buildPrompt(backend === "gpt" ? "nl" : "tag"));

      setGenProgress(backend === "gpt" ? "发送至GPT生成中…" : "发送至NAI生成中…");
      const dataUrl = backend === "gpt" ? await runGpt(tag) : await runNai(tag, negative);

      const newItem = { dataUrl, prompt:tag, negative, schemeId:selectedScheme?.id || "",
        schemeName, color:colorHex, id:Date.now() };
      setResultImg(newItem); onSaveToWardrobe(newItem); setChatMessages([]);
    } catch (err) {
      console.error("生成失败:", err);
      setGenProgress(`生成失败：${err.message || String(err)}`);
      setGenerating(false);
      return;
    }
    setGenerating(false);
  };

  // ── 渲染 ──
  const optLabel = (txt) => <SectionLabel>{txt}</SectionLabel>;
  const series = PALETTE_SERIES[paletteIdx] || PALETTE_SERIES[0];

  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%",overflow:"hidden" }}>
      <div ref={scrollRef} style={{ flex:1,overflowY:"auto",padding:"16px" }}>

        {/* ── 01 上传 ── */}
        <div style={{ marginBottom:"18px" }}>
          <div style={{ display:"flex",alignItems:"center" }}>
            <div style={{ flex:1 }}>{optLabel("01 · 上传衣物图片（选填，自己的或网图）")}</div>
            <button onClick={reset} style={{ background:"none",border:"none",fontSize:"10px",
              color:T.textMuted,cursor:"pointer",padding:"0 0 8px" }}>全部清空</button>
          </div>
          {!uploadedImg ? (
            <div>
              <button onClick={()=>fileRef.current?.click()} style={{
                width:"100%", padding:"28px 0", borderRadius:T.radius,
                border:`1.5px dashed ${T.border}`, backgroundColor:T.surface,
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                gap:"8px",cursor:"pointer",marginBottom:"12px",
              }}>
                <span style={{ fontSize:"28px",opacity:0.3 }}>+</span>
                <span style={{ fontSize:"11px",color:T.textMuted }}>点击上传衣物图片</span>
              </button>
              <div style={{ backgroundColor:T.surface,borderRadius:T.radius,
                border:`1px solid ${T.border}`,padding:"12px" }}>
                <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 8px",letterSpacing:"0.05em" }}>
                  ↓ Artifact测试：直接载入色卡，无需上传图片
                </p>
                <div style={{ display:"flex",flexWrap:"wrap",gap:"6px" }}>
                  {TEST_OUTFITS.map((outfit,i)=>(
                    <button key={i} onClick={()=>handleLoadTestOutfit(outfit)} style={{
                      padding:"5px 10px",borderRadius:"20px",border:`1px solid ${T.border}`,
                      backgroundColor:T.bg,fontSize:"11px",color:T.textSub,cursor:"pointer",
                      display:"flex",alignItems:"center",gap:"5px",
                    }}>
                      <div style={{ display:"flex",gap:"2px" }}>
                        {outfit.colors.slice(0,3).map((c,ci)=>(
                          <div key={ci} style={{ width:"8px",height:"8px",borderRadius:"50%",backgroundColor:c.hex }}/>
                        ))}
                      </div>
                      {outfit.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:"8px",
                padding:"8px 10px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.surface,marginBottom:"8px" }}>
                {uploadedImg.url ? (
                  <img src={uploadedImg.url} alt="" style={{ width:"36px",height:"36px",
                    objectFit:"cover",borderRadius:"6px",border:`1px solid ${T.border}`,flexShrink:0 }}/>
                ) : (
                  <div style={{ display:"flex",gap:"3px",flexShrink:0 }}>
                    {extractedColors.slice(0,4).map((c,i)=>(
                      <div key={i} style={{ width:"18px",height:"18px",borderRadius:"4px",
                        backgroundColor:c.hex,border:"1px solid rgba(0,0,0,0.08)" }}/>
                    ))}
                  </div>
                )}
                <span style={{ fontSize:"12px",color:T.text,fontWeight:"500",flex:1,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  {uploadedImg.url ? uploadedImg.name : uploadedImg.mockName}
                  {!uploadedImg.url && <span style={{ fontSize:"10px",color:T.textMuted,fontWeight:"400" }}> · 测试色卡</span>}
                </span>
                <button onClick={()=>fileRef.current?.click()} style={{
                  padding:"4px 8px",borderRadius:"6px",border:`1px solid ${T.border}`,
                  backgroundColor:T.bg,fontSize:"10px",color:T.textSub,cursor:"pointer",flexShrink:0 }}>换图</button>
                <button onClick={()=>{ setUploadedImg(null); setExtractedColors([]); }} style={{
                  padding:"4px 8px",borderRadius:"6px",border:"none",
                  backgroundColor:"transparent",fontSize:"10px",color:T.textMuted,cursor:"pointer",flexShrink:0 }}>移除</button>
              </div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:"5px" }}>
                {TEST_OUTFITS.map((outfit,i)=>(
                  <button key={i} onClick={()=>handleLoadTestOutfit(outfit)} style={{
                    padding:"4px 8px",borderRadius:"20px",
                    border:`1px solid ${uploadedImg.mockName===outfit.name?T.accent:T.border}`,
                    backgroundColor:uploadedImg.mockName===outfit.name?T.accentSoft:T.bg,
                    fontSize:"10px",color:T.textSub,cursor:"pointer",
                    display:"flex",alignItems:"center",gap:"4px" }}>
                    <div style={{ display:"flex",gap:"2px" }}>
                      {outfit.colors.slice(0,3).map((c,ci)=>(
                        <div key={ci} style={{ width:"7px",height:"7px",borderRadius:"50%",backgroundColor:c.hex }}/>
                      ))}
                    </div>
                    {outfit.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleUpload}/>
        </div>

        {/* ── 02 衣物主色（只选颜色，不再跳页）── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("02 · 衣物主色（选填）")}
          {extractedColors.length > 0 && (
            <div style={{ marginBottom:"10px" }}>
              <p style={{ fontSize:"9px",color:T.textMuted,margin:"0 0 5px" }}>从图片提取</p>
              <div style={{ display:"flex",gap:"8px",flexWrap:"wrap" }}>
                {extractedColors.map((c,i)=>(
                  <button key={i} onClick={()=>setSelectedColor(c)} style={{
                    width:"34px",height:"34px",borderRadius:"9px",
                    backgroundColor:c.hex,border:"none",cursor:"pointer",flexShrink:0,
                    outline:selectedColor?.hex===c.hex?`3px solid ${T.accent}`:"3px solid transparent",
                    outlineOffset:"2px",transition:"outline 0.15s",boxShadow:T.shadow }}/>
                ))}
              </div>
            </div>
          )}
          <p style={{ fontSize:"9px",color:T.textMuted,margin:"0 0 5px" }}>色卡库</p>
          <div style={{ display:"flex",gap:"5px",overflowX:"auto",paddingBottom:"6px",marginBottom:"6px" }}>
            {PALETTE_SERIES.map((s,i)=>(
              <button key={s.name} onClick={()=>setPaletteIdx(i)} style={{
                padding:"4px 10px",borderRadius:"14px",flexShrink:0,cursor:"pointer",fontSize:"10px",
                border:`1px solid ${paletteIdx===i?T.accent:T.border}`,
                backgroundColor:paletteIdx===i?T.accent:T.surface,
                color:paletteIdx===i?"#fff":T.textSub }}>{s.name}</button>
            ))}
          </div>
          <div style={{ display:"flex",gap:"10px",flexWrap:"wrap",marginBottom:"10px" }}>
            {series.colors.map(([name,hex])=>(
              <button key={hex} onClick={()=>{ setSelectedColor(makeColor(hex)); setHexInput(hex); }} style={{
                display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",
                background:"none",border:"none",cursor:"pointer",padding:0 }}>
                <div style={{ width:"34px",height:"34px",borderRadius:"9px",backgroundColor:hex,
                  outline:selectedColor?.hex===hex.toLowerCase()?`3px solid ${T.accent}`:"3px solid transparent",
                  outlineOffset:"2px",boxShadow:T.shadow,transition:"outline 0.15s" }}/>
                <span style={{ fontSize:"9px",color:T.textSub }}>{name}</span>
              </button>
            ))}
          </div>
          <div style={{ display:"flex",gap:"8px",alignItems:"center" }}>
            <label style={{ position:"relative",width:"34px",height:"34px",flexShrink:0 }} title="自定义取色">
              <div style={{ width:"34px",height:"34px",borderRadius:"9px",border:`1.5px dashed ${T.border}`,
                display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontSize:"16px" }}>+</div>
              <input type="color" value={selectedColor?.hex || "#c8b090"}
                onChange={e=>{ setSelectedColor(makeColor(e.target.value)); setHexInput(e.target.value); }}
                style={{ position:"absolute",inset:0,opacity:0,width:"100%",height:"100%",cursor:"pointer" }}/>
            </label>
            <input value={hexInput} onChange={e=>pickHex(e.target.value)} placeholder="输入 hex，如 #C7654D"
              style={{ ...inputStyle,flex:1,fontFamily:"monospace" }}/>
          </div>
          {selectedColor && (
            <div style={{ display:"flex",alignItems:"center",gap:"10px",marginTop:"10px",
              backgroundColor:T.surface,borderRadius:T.radiusSm,padding:"8px 12px",border:`1px solid ${T.border}` }}>
              <div style={{ width:"28px",height:"28px",borderRadius:"6px",
                backgroundColor:selectedColor.hex,border:"1px solid rgba(0,0,0,0.1)" }}/>
              <span style={{ fontSize:"11px",color:T.textSub,fontFamily:"monospace",flex:1 }}>
                {selectedColor.hex.toUpperCase()} · H{selectedColor.hsl.h}° S{selectedColor.hsl.s}% L{selectedColor.hsl.l}%
              </span>
              <button onClick={()=>{ setSelectedColor(null); setHexInput(""); }} style={{ background:"none",
                border:"none",fontSize:"10px",color:T.textMuted,cursor:"pointer" }}>清除</button>
            </div>
          )}
        </div>

        {/* ── 03 肤色 ── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("03 · 肤色（选填，配色参照；不选按自然白）")}
          <div style={{ display:"flex",gap:"6px",flexWrap:"wrap" }}>
            {SKIN_TONES.map(skin=>(
              <button key={skin.id} onClick={()=>setSelectedSkin(selectedSkin?.id===skin.id?null:skin)} style={{
                display:"flex",flexDirection:"column",alignItems:"center",gap:"4px",
                padding:"6px 8px",borderRadius:"9px",border:"none",cursor:"pointer",
                backgroundColor:selectedSkin?.id===skin.id?T.surface:"transparent",
                outline:selectedSkin?.id===skin.id?`2px solid ${T.accent}`:"2px solid transparent",
                outlineOffset:"1px" }}>
                <div style={{ width:"30px",height:"30px",borderRadius:"50%",
                  backgroundColor:skin.hex,border:"1px solid rgba(0,0,0,0.1)",boxShadow:T.shadow }}/>
                <span style={{ fontSize:"9px",color:T.textSub }}>{skin.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 04 款式 ── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("04 · 款式（选填，自填单品，可选颜色）")}
          {garments.map(g=>(
            <div key={g.id} style={{ display:"flex",gap:"6px",alignItems:"center",marginBottom:"6px" }}>
              <input value={g.name}
                onChange={e=>{ updateGarment(g.id,{name:e.target.value}); if(e.target.value.trim()) clearToggle("garment"); }}
                placeholder="如：夹克 / 短裙 / 玛丽珍鞋" style={{ ...inputStyle,flex:1 }}/>
              <label style={{ position:"relative",width:"32px",height:"32px",flexShrink:0 }} title="选颜色（可不选）">
                <div style={{ width:"32px",height:"32px",borderRadius:"8px",
                  border:g.color?"1px solid rgba(0,0,0,0.1)":`1.5px dashed ${T.border}`,
                  backgroundColor:g.color||"transparent",
                  display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontSize:"13px" }}>
                  {g.color ? "" : "◐"}
                </div>
                <input type="color" value={g.color||"#c8b090"} onChange={e=>updateGarment(g.id,{color:e.target.value})}
                  style={{ position:"absolute",inset:0,opacity:0,width:"100%",height:"100%",cursor:"pointer" }}/>
              </label>
              {g.color ? (
                <button onClick={()=>updateGarment(g.id,{color:""})} style={{ background:"none",border:"none",
                  fontSize:"10px",color:T.textMuted,cursor:"pointer",flexShrink:0 }}>清色</button>
              ) : null}
              <button onClick={()=>removeGarment(g.id)} style={{ background:"none",border:"none",
                fontSize:"16px",color:T.textMuted,cursor:"pointer",padding:"0 2px",flexShrink:0 }}>×</button>
            </div>
          ))}
          <button onClick={addGarment} style={{ width:"100%",padding:"7px",borderRadius:T.radiusSm,
            border:`1.5px dashed ${T.border}`,backgroundColor:"transparent",fontSize:"11px",
            color:T.textMuted,cursor:"pointer" }}>+ 添加单品</button>
        </div>

        {/* ── 05 季节 ── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("05 · 季节（选填，穿的是哪个季节的衣服）")}
          <div style={{ display:"flex",gap:"6px" }}>
            {SEASONS.map(s=>(
              <Chip key={s.id} active={season===s.id}
                onClick={()=>{ const next = season===s.id ? null : s.id; setSeason(next); if(next) clearToggle("season"); }}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* ── 06 性别 / 身高体重 ── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("06 · 性别 / 身高体重（选填，用于比例与量感建议）")}
          <div style={{ display:"flex",gap:"6px",marginBottom:"8px" }}>
            {GENDERS.map(g=>(
              <Chip key={g.id} active={gender===g.id} onClick={()=>setGender(g.id)}>{g.label}</Chip>
            ))}
          </div>
          <div style={{ display:"flex",gap:"10px" }}>
            <div style={{ flex:1,position:"relative" }}>
              <input type="number" inputMode="decimal" value={height} placeholder="身高"
                onChange={e=>{ setHeight(e.target.value); if(Number(e.target.value)>0) clearToggle("body"); }}
                style={{ ...inputStyle,paddingRight:"34px" }}/>
              <span style={{ position:"absolute",right:"11px",top:"50%",transform:"translateY(-50%)",
                fontSize:"10px",color:T.textMuted }}>cm</span>
            </div>
            <div style={{ flex:1,position:"relative" }}>
              <input type="number" inputMode="decimal" value={weight} placeholder="体重"
                onChange={e=>{ setWeight(e.target.value); if(Number(e.target.value)>0) clearToggle("body"); }}
                style={{ ...inputStyle,paddingRight:"34px" }}/>
              <span style={{ position:"absolute",right:"11px",top:"50%",transform:"translateY(-50%)",
                fontSize:"10px",color:T.textMuted }}>kg</span>
            </div>
          </div>
          <p style={{ fontSize:"9px",color:T.textMuted,margin:"6px 0 0",lineHeight:1.5 }}>
            身高管比例，体重管量感；两项都填体型判断更准。体重数值不会出现在结果里。
          </p>
        </div>

        {/* ── 07 脸型 ── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("07 · 脸型（选填，不确定就不选）")}
          <div style={{ display:"flex",gap:"6px",flexWrap:"wrap" }}>
            {FACE_SHAPES.map(f=>(
              <Chip key={f.id} active={faceId===f.id}
                onClick={()=>{ const next = faceId===f.id ? null : f.id; setFaceId(next); if(next) clearToggle("face"); }}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* ── 08 自然语言描述 ── */}
        <div style={{ marginBottom:"18px" }}>
          {optLabel("08 · 自然语言描述（选填，由文字API转成生图提示词）")}
          <textarea value={nlDesc} onChange={e=>setNlDesc(e.target.value)} rows={3}
            placeholder="想要的整体感觉、场合、风格…"
            style={{ ...inputStyle,resize:"vertical",fontFamily:"inherit",lineHeight:1.5 }}/>
        </div>

        {/* ── 配色方案 ── */}
        {schemes.length > 0 && (
          <div style={{ marginBottom:"18px" }}>
            {optLabel("配色方案")}
            {schemes.map(s=>(
              <div key={s.id} onClick={()=>setSchemeId(s.id)}
                style={{ padding:"12px",borderRadius:T.radius,marginBottom:"8px",
                  border:`2px solid ${selectedScheme?.id===s.id?T.accent:T.border}`,
                  backgroundColor:selectedScheme?.id===s.id?"#fff":T.surface,
                  cursor:"pointer",transition:"all 0.15s" }}>
                <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px" }}>
                  <span style={{ fontSize:"11px",fontWeight:"600",color:T.text }}>{s.name}</span>
                  {selectedScheme?.id===s.id && <span style={{ fontSize:"9px",color:T.accent,
                    backgroundColor:T.accentSoft,padding:"2px 6px",borderRadius:"10px" }}>已选</span>}
                </div>
                <p style={{ fontSize:"10px",color:T.textSub,margin:"0 0 8px",lineHeight:1.5 }}>{s.desc}</p>
                {s.warning && <p style={{ fontSize:"10px",color:T.warn,margin:"0 0 8px",lineHeight:1.5 }}>{s.warning}</p>}
                <div style={{ display:"flex",alignItems:"flex-end",gap:"6px",flexWrap:"wrap" }}>
                  {s.colors.map((c,ci)=>(
                    <ColorSwatch key={ci} hex={c.hex} label={c.label} size={c.size} isRef={c.isRef}/>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 参与分析：勾选才生效 ── */}
        <div style={{ marginBottom:"14px",padding:"12px",borderRadius:T.radius,
          border:`1px solid ${T.border}`,backgroundColor:T.surface }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 8px",letterSpacing:"0.05em" }}>
            参与分析（勾选才生效；已填写的自动勾选）
          </p>
          <div style={{ display:"flex",gap:"6px",flexWrap:"wrap" }}>
            {FIELD_KEYS.map(f=>(
              <ToggleChip key={f.key} on={isOn(f.key)} onClick={()=>flip(f.key)}>{f.label}</ToggleChip>
            ))}
          </div>
          {toggleNotes.length > 0 && (
            <div style={{ marginTop:"8px" }}>
              {toggleNotes.map((n,i)=>(
                <p key={i} style={{ fontSize:"9px",color:T.textMuted,margin:"2px 0 0",lineHeight:1.5 }}>· {n}</p>
              ))}
            </div>
          )}
        </div>

        {/* ── 生图 ── */}
        <div style={{ marginBottom:"18px" }}>
          <div style={{ display:"flex",gap:"6px",marginBottom:"8px" }}>
            {[{id:"nai",label:"NAI"},{id:"gpt",label:"GPT（第三方）"}].map(b=>(
              <Chip key={b.id} active={backend===b.id} onClick={()=>setBackend(b.id)}>{b.label}</Chip>
            ))}
          </div>
          <button onClick={()=>handleGenerate()} disabled={generating||!canGenerate}
            style={{ width:"100%",padding:"11px",borderRadius:T.radiusSm,border:"none",
              backgroundColor:(generating||!canGenerate)?T.border:T.accent,
              color:(generating||!canGenerate)?T.textMuted:"#fff",
              fontSize:"12px",fontWeight:"500",cursor:(generating||!canGenerate)?"default":"pointer" }}>
            {generating ? genProgress||"生成中…"
              : (backend==="gpt"?settings.gptApiKey:settings.naiToken) ? "生成穿搭" : "生成穿搭（测试模式）"}
          </button>
          {!generating && !canGenerate && (
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"4px 0 0",textAlign:"center" }}>
              至少填一项（主色、款式、季节、身高体重、脸型或描述）
            </p>
          )}
          {!generating && canGenerate && !(backend==="gpt"?settings.gptApiKey:settings.naiToken) && (
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"4px 0 0",textAlign:"center" }}>
              未填{backend==="gpt"?"GPT Key":"NAI Token"}，将生成占位色块用于流程测试
            </p>
          )}
          {!generating && genProgress.startsWith("生成失败") && (
            <p style={{ fontSize:"10px",color:T.warn,margin:"6px 0 0",lineHeight:1.5 }}>{genProgress}</p>
          )}
        </div>

        {/* ── 搭配分析结果 ── */}
        {analysis && (
          <div style={{ marginBottom:"18px",padding:"12px",borderRadius:T.radius,
            border:`1px solid ${T.border}`,backgroundColor:T.surface }}>
            <button onClick={()=>setShowAnalysis(v=>!v)} style={{ width:"100%",display:"flex",
              alignItems:"center",background:"none",border:"none",padding:0,cursor:"pointer" }}>
              <span style={{ fontSize:"11px",fontWeight:"600",color:T.text,flex:1,textAlign:"left" }}>搭配分析</span>
              <span style={{ fontSize:"10px",color:T.textMuted }}>{showAnalysis?"收起":"展开"}</span>
            </button>
            {showAnalysis && (
              <p style={{ fontSize:"11px",color:T.textSub,margin:"10px 0 0",lineHeight:1.7,whiteSpace:"pre-wrap" }}>{analysis}</p>
            )}
          </div>
        )}

        {/* ── 生图结果 ── */}
        {resultImg && (
          <div style={{ marginBottom:"18px" }} ref={resultRef}>
            {optLabel("生成结果")}
            <div style={{ borderRadius:T.radius,overflow:"hidden",border:`1px solid ${T.border}`,
              boxShadow:T.shadowMd,marginBottom:"10px",position:"relative",cursor:"context-menu" }}
              onContextMenu={e=>{e.preventDefault();setShowPromptEdit(v=>!v);setEditingPrompt(resultImg.prompt||"");}}
              onTouchStart={e=>{
                const t=setTimeout(()=>{setShowPromptEdit(v=>!v);setEditingPrompt(resultImg.prompt||"");},600);
                e.currentTarget._lpt=t;
              }}
              onTouchEnd={e=>{clearTimeout(e.currentTarget._lpt);}}
              onTouchMove={e=>{clearTimeout(e.currentTarget._lpt);}}>
              <img src={resultImg.dataUrl} alt="生成图" style={{ width:"100%",display:"block" }}/>
              <div style={{ position:"absolute",bottom:"8px",right:"8px",
                backgroundColor:"rgba(0,0,0,0.45)",borderRadius:"6px",
                padding:"3px 7px",fontSize:"9px",color:"rgba(255,255,255,0.7)",
                pointerEvents:"none" }}>右键/长按编辑Prompt</div>
            </div>
            {showPromptEdit ? (
              <div style={{ marginBottom:"10px" }}>
                <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 4px" }}>Prompt（可编辑后重新生成）</p>
                <textarea value={editingPrompt} onChange={e=>setEditingPrompt(e.target.value)}
                  rows={5} style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                    border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"10px",
                    color:T.text,outline:"none",resize:"vertical",boxSizing:"border-box",
                    fontFamily:"monospace",lineHeight:1.5 }}/>
                <div style={{ display:"flex",gap:"6px",marginTop:"6px" }}>
                  <Btn onClick={()=>handleGenerate(editingPrompt)} style={{ flex:1,fontSize:"11px",padding:"7px" }}>
                    用此prompt重新生成
                  </Btn>
                  <Btn onClick={()=>setShowPromptEdit(false)} variant="ghost" style={{ fontSize:"11px",padding:"7px" }}>
                    关闭
                  </Btn>
                </div>
              </div>
            ) : (
              <button onClick={()=>{setEditingPrompt(resultImg.prompt);setShowPromptEdit(true);}}
                style={{ width:"100%",padding:"7px",borderRadius:T.radiusSm,marginBottom:"8px",
                  border:`1px solid ${T.border}`,backgroundColor:T.surface,
                  fontSize:"10px",color:T.textMuted,cursor:"pointer",textAlign:"left",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                ✎ {resultImg.prompt?.slice(0,60)}…
              </button>
            )}
            <div style={{ display:"flex",gap:"8px" }}>
              <Btn onClick={()=>setChatOpen(true)} variant="ghost" style={{ flex:1 }}>💬 问char</Btn>
              <div style={{ flex:1, padding:"9px 14px", borderRadius:T.radiusSm,
                backgroundColor:"#e8f4e8", color:"#5a8a5a",
                fontSize:"12px", textAlign:"center", fontWeight:"500" }}>
                ✓ 已自动存入
              </div>
              <Btn onClick={()=>handleGenerate()} variant="ghost" style={{ padding:"9px 12px" }}>↺</Btn>
            </div>
          </div>
        )}
      </div>

      {chatOpen && <ChatModal imageItem={resultImg} onClose={()=>setChatOpen(false)} settings={settings} onUpdateMemory={onUpdateMemory} messages={chatMessages} setMessages={setChatMessages}/>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Prompt编辑覆盖层（成品区右键用）
// ═══════════════════════════════════════════════════════
function PromptEditOverlay({ item, onClose, onRegenerate }) {
  const [tag, setTag] = useState(item?.prompt||"");
  return (
    <div style={{ position:"fixed",inset:0,zIndex:350,backgroundColor:"rgba(0,0,0,0.6)",
      display:"flex",alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ width:"100%",maxWidth:"480px",margin:"0 auto",
        backgroundColor:T.surface,borderRadius:"20px 20px 0 0",
        padding:"16px",boxShadow:"0 -4px 32px rgba(0,0,0,0.2)",
        maxHeight:"70vh",display:"flex",flexDirection:"column",gap:"10px" }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
          <p style={{ fontSize:"12px",fontWeight:"600",color:T.text,margin:0,flex:1 }}>NAI Prompt</p>
          <button onClick={onClose} style={{ background:"none",border:"none",
            color:T.textMuted,fontSize:"20px",cursor:"pointer" }}>×</button>
        </div>
        <textarea value={tag} onChange={e=>setTag(e.target.value)} rows={8}
          style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
            border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"10px",
            color:T.text,outline:"none",resize:"vertical",boxSizing:"border-box",
            fontFamily:"monospace",lineHeight:1.6,flex:1 }}/>
        <div style={{ display:"flex",gap:"8px" }}>
          <button onClick={()=>{onRegenerate(tag);onClose();}} style={{
            flex:1,padding:"10px",borderRadius:T.radiusSm,border:"none",
            backgroundColor:T.accent,color:"#fff",fontSize:"12px",cursor:"pointer",fontWeight:"500",
          }}>用此Prompt重新生成</button>
          <button onClick={onClose} style={{
            padding:"10px 14px",borderRadius:T.radiusSm,
            border:`1px solid ${T.border}`,backgroundColor:T.surface,
            fontSize:"12px",color:T.textSub,cursor:"pointer",
          }}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 大图预览弹窗
// ═══════════════════════════════════════════════════════
function ImagePreview({ item, onClose }) {
  if (!item) return null;
  return (
    <div style={{ position:"fixed",inset:0,zIndex:400,backgroundColor:"rgba(0,0,0,0.85)",
      display:"flex",alignItems:"center",justifyContent:"center" }}
      onClick={onClose}>
      <div style={{ position:"relative",maxWidth:"92vw",maxHeight:"92vh",
        display:"flex",flexDirection:"column",alignItems:"center",gap:"10px" }}
        onClick={e=>e.stopPropagation()}>
        <button onClick={onClose} style={{
          position:"absolute",top:"-36px",right:0,
          background:"none",border:"none",color:"rgba(255,255,255,0.7)",
          fontSize:"28px",cursor:"pointer",lineHeight:1,padding:"4px",
        }}>×</button>
        {item.dataUrl ? (
          <img src={item.dataUrl} alt="" style={{
            maxWidth:"92vw",maxHeight:"85vh",objectFit:"contain",
            borderRadius:"8px",display:"block",
          }}/>
        ) : (
          <div style={{ width:"280px",height:"400px",borderRadius:"8px",
            backgroundColor:item.color||"#666",
            display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ color:"rgba(255,255,255,0.5)",fontSize:"12px" }}>图片未加载</span>
          </div>
        )}
        {item.schemeName && (
          <p style={{ color:"rgba(255,255,255,0.6)",fontSize:"11px",margin:0 }}>
            {item.schemeName}
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 成品区右键/长按菜单
// ═══════════════════════════════════════════════════════
function ContextMenu({ item, pos, onClose, onRegenerate, onDelete, onExport, onViewPrompt, isProduct }) {
  return (
    <div style={{ position:"fixed",inset:0,zIndex:300 }} onClick={onClose}>
      <div style={{ position:"fixed",left:Math.min(pos.x,window.innerWidth-180),
        top:Math.min(pos.y,window.innerHeight-160),
        backgroundColor:"#fff",borderRadius:T.radius,
        boxShadow:"0 8px 32px rgba(0,0,0,0.18)",
        border:`1px solid ${T.border}`,overflow:"hidden",width:"170px",
      }} onClick={e=>e.stopPropagation()}>
        {/* prompt预览（仅成品区） */}
        {isProduct && item.prompt && (
          <div style={{ padding:"10px 12px",borderBottom:`1px solid ${T.border}`,
            backgroundColor:T.surface }}>
            <p style={{ fontSize:"9px",color:T.textMuted,margin:"0 0 2px" }}>NAI Prompt</p>
            <p style={{ fontSize:"10px",color:T.textSub,margin:0,lineHeight:1.4,
              maxHeight:"48px",overflow:"hidden",display:"-webkit-box",
              WebkitLineClamp:3,WebkitBoxOrient:"vertical" }}>{item.prompt}</p>
          </div>
        )}
        {(isProduct ? [
          { label:"查看Prompt", action:onViewPrompt },
          { label:"重新生成（保留旧图）", action:onRegenerate },
          { label:"导出图片", action:onExport },
          { label:"删除", action:onDelete, danger:true },
        ] : [
          { label:"导出图片", action:onExport },
          { label:"删除", action:onDelete, danger:true },
        ]).map(btn=>(
          <button key={btn.label} onClick={()=>{btn.action();onClose();}}
            style={{ width:"100%",padding:"11px 14px",border:"none",textAlign:"left",
              backgroundColor:"transparent",fontSize:"12px",cursor:"pointer",display:"block",
              color:btn.danger?T.warn:T.text }}>
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 衣橱页
// ═══════════════════════════════════════════════════════
function WardrobePage({ genPool, setGenPool, materials, setMaterials, settings, onRegenerate }) {
  const [tab, setTab] = useState("material"); // material | product
  // materials/setMaterials从App层传入
  const [selected, setSelected] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [promptEditItem, setPromptEditItem] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const fileRef = useRef(null);

  const isProduct = tab === "product";
  const items = isProduct ? genPool : materials;

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearSelect = () => setSelected(new Set());

  const handleUploadMaterial = (e) => {
    Array.from(e.target.files||[]).forEach(file=>{
      const url = URL.createObjectURL(file);
      setMaterials(prev=>[{id:Date.now()+Math.random(),dataUrl:url,
        name:file.name,savedAt:new Date().toLocaleString("zh-CN")}, ...prev]);
    });
    e.target.value="";
  };

  const deleteSelected = () => {
    if (isProduct) setGenPool(p=>{ const next=p.filter(i=>!selected.has(i.id)); savePool(next); return next; });
    else setMaterials(p=>{ const next=p.filter(i=>!selected.has(i.id)); saveMaterials(next); return next; });
    clearSelect();
  };

  const exportSelected = async () => {
    const targets = items.filter(i=>selected.has(i.id));
    for (const item of targets) {
      if (!item.dataUrl) continue;
      const a = document.createElement("a");
      a.href = item.dataUrl;
      a.download = `wardrobe_${item.id}.png`;
      a.click();
      await new Promise(r=>setTimeout(r,200));
    }
  };

  const packAll = async () => {
    // 取全分辨率原图：内存里有就用，没有就从 IndexedDB 补
    const targets = [];
    for (const it of genPool) {
      let url = it.dataUrl;
      if (!url) { try { url = (await idbGet(it.id))?.dataUrl || null; } catch {} }
      if (url) targets.push({ id: it.id, url });
    }
    if (!targets.length) return;
    try {
      // GitHub Pages 静态部署，运行时从 CDN 动态加载 JSZip
      const mod = await import(/* @vite-ignore */ "https://esm.sh/jszip@3.10.1");
      const JSZip = mod.default || mod;
      const zip = new JSZip();
      targets.forEach((it, idx) => {
        const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(it.url);
        const ext = m ? m[1].split("/")[1].replace("jpeg","jpg") : "png";
        const b64 = m ? m[2] : (it.url.split(",")[1] || "");
        if (b64) zip.file(`nai_${String(idx+1).padStart(3,"0")}_${it.id}.${ext}`, b64, { base64:true });
      });
      const blob = await zip.generateAsync({ type:"blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `wardrobe_${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    } catch (e) {
      // CDN 不可用时退回逐张下载
      console.warn("JSZip打包失败，改为逐张下载:", e);
      for (const it of targets) {
        const a = document.createElement("a");
        a.href = it.url; a.download = `nai_${it.id}.png`; a.click();
        await new Promise(r => setTimeout(r, 300));
      }
    }
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    setContextMenu({ item, x:e.clientX||e.touches?.[0]?.clientX||100, y:e.clientY||e.touches?.[0]?.clientY||100 });
  };

  const handleLongPressStart = (e, item) => {
    const touch = e.touches?.[0];
    const timer = setTimeout(()=>{
      setContextMenu({ item, x:touch?.clientX||100, y:touch?.clientY||100 });
    }, 500);
    setLongPressTimer(timer);
  };
  const handleLongPressEnd = () => { clearTimeout(longPressTimer); };

  const exportOne = (item) => {
    if (!item.dataUrl) return;
    const a = document.createElement("a");
    a.href=item.dataUrl; a.download=`wardrobe_${item.id}.png`; a.click();
  };

  const deleteOne = (item) => {
    if (isProduct) setGenPool(p=>{ const next=p.filter(i=>i.id!==item.id); savePool(next); return next; });
    else setMaterials(p=>{ const next=p.filter(i=>i.id!==item.id); saveMaterials(next); return next; });
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%",overflow:"hidden" }}>
      {/* Tab */}
      <div style={{ display:"flex",borderBottom:`1px solid ${T.border}`,
        backgroundColor:T.surface,flexShrink:0 }}>
        {[{key:"material",label:"材料区"},{key:"product",label:"成品区"}].map(t=>(
          <button key={t.key} onClick={()=>{setTab(t.key);clearSelect();}} style={{
            flex:1,padding:"13px",border:"none",background:"none",
            fontSize:"13px",fontWeight:tab===t.key?"600":"400",
            color:tab===t.key?T.text:T.textMuted,
            borderBottom:tab===t.key?`2px solid ${T.accent}`:"2px solid transparent",
            cursor:"pointer" }}>{t.label}</button>
        ))}
      </div>

      {/* 工具栏 */}
      <div style={{ padding:"10px 14px",borderBottom:`1px solid ${T.borderLight}`,
        backgroundColor:T.surface,display:"flex",gap:"8px",alignItems:"center",flexShrink:0 }}>
        {!isProduct && (
          <button onClick={()=>fileRef.current?.click()} style={{
            padding:"6px 12px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,
            backgroundColor:T.bg,fontSize:"11px",color:T.textSub,cursor:"pointer" }}>+ 上传</button>
        )}
        {selected.size>0 ? (
          <>
            <span style={{ fontSize:"11px",color:T.textMuted }}>{selected.size}张已选</span>
            <Btn onClick={exportSelected} variant="ghost" style={{ padding:"6px 10px",fontSize:"11px" }}>导出</Btn>
            <Btn onClick={deleteSelected} variant="danger" style={{ padding:"6px 10px",fontSize:"11px" }}>删除</Btn>
            <Btn onClick={clearSelect} variant="ghost" style={{ padding:"6px 10px",fontSize:"11px" }}>取消</Btn>
          </>
        ) : (
          <>
            {isProduct && genPool.length>0 && (
              <Btn onClick={packAll} variant="ghost" style={{ padding:"6px 10px",fontSize:"11px" }}>打包下载</Btn>
            )}
            <span style={{ fontSize:"10px",color:T.textMuted,marginLeft:"auto" }}>
              长按/右键查看操作
            </span>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={handleUploadMaterial}/>
      </div>

      {/* 图片网格 */}
      <div style={{ flex:1,overflowY:"auto",padding:"12px 14px" }}>
        {items.length===0 ? (
          <div style={{ textAlign:"center",padding:"60px 0",color:T.textMuted }}>
            <p style={{ fontSize:"28px",margin:"0 0 8px",opacity:0.25 }}>{isProduct?"✦":"👗"}</p>
            <p style={{ fontSize:"11px",margin:0 }}>
              {isProduct?"还没有生成图，去搭配页生成":"还没有上传衣物，点击上传"}
            </p>
          </div>
        ) : (
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"6px" }}>
            {items.map(item=>(
              <div key={item.id}
                style={{ position:"relative",aspectRatio:"3/4",cursor:"pointer" }}
                onClick={()=>selected.size>0?toggleSelect(item.id):setPreviewItem(item)}
                onContextMenu={e=>{e.preventDefault();handleContextMenu(e,item);}}
                onTouchStart={e=>handleLongPressStart(e,item)}
                onTouchEnd={handleLongPressEnd}
                onTouchMove={handleLongPressEnd}
              >
                {item.dataUrl ? (
                  <img src={item.dataUrl} alt="" style={{ width:"100%",height:"100%",
                    objectFit:"cover",borderRadius:"9px",display:"block",
                    border:`1px solid ${T.border}` }}/>
                ) : (
                  <div style={{ width:"100%",height:"100%",borderRadius:"9px",
                    backgroundColor:item.color||"#ccc",border:`1px solid ${T.border}` }}/>
                )}
                {/* 选中覆盖层 */}
                {selected.size>0 && (
                  <div onClick={e=>{e.stopPropagation();toggleSelect(item.id);}} style={{
                    position:"absolute",inset:0,borderRadius:"9px",
                    backgroundColor:selected.has(item.id)?"rgba(0,0,0,0.35)":"transparent",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    border:selected.has(item.id)?`2px solid ${T.accent}`:"none",
                  }}>
                    {selected.has(item.id) && <span style={{ fontSize:"22px",color:"#fff" }}>✓</span>}
                  </div>
                )}
                {/* 成品标签 */}
                {isProduct && (
                  <div style={{ position:"absolute",bottom:0,left:0,right:0,padding:"4px 6px",
                    background:"linear-gradient(transparent,rgba(0,0,0,0.55))",
                    borderRadius:"0 0 9px 9px",
                    fontSize:"8px",color:"rgba(255,255,255,0.85)",lineHeight:1.3 }}>
                    {item.schemeName||"NAI"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prompt编辑 */}
      {promptEditItem && (
        <PromptEditOverlay item={promptEditItem} onClose={()=>setPromptEditItem(null)}
          onRegenerate={(newTag)=>onRegenerate({...promptEditItem, overrideTag:newTag})}/>
      )}

      {/* 大图预览 */}
      {previewItem && <ImagePreview item={previewItem} onClose={()=>setPreviewItem(null)}/>}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          item={contextMenu.item}
          pos={{ x:contextMenu.x, y:contextMenu.y }}
          isProduct={isProduct}
          onClose={()=>setContextMenu(null)}
          onRegenerate={()=>onRegenerate(contextMenu.item)}
          onDelete={()=>deleteOne(contextMenu.item)}
          onExport={()=>exportOne(contextMenu.item)}
          onViewPrompt={()=>{
            const p = contextMenu.item.prompt||"无prompt";
            alert(`NAI Prompt:

${p}`);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 设置页
// ═══════════════════════════════════════════════════════
// 设置页专用：提取到外部避免每次render重建导致输入框跳位
function SettingsSection({ title, children }) {
  return (
    <div style={{ backgroundColor:T.surface,border:`1px solid ${T.border}`,
      borderRadius:T.radius,padding:"16px",marginBottom:"12px" }}>
      <p style={{ fontSize:"12px",fontWeight:"600",color:T.text,margin:"0 0 14px" }}>{title}</p>
      {children}
    </div>
  );
}
function SettingsField({ label, fkey, placeholder, multiline, type, form, setForm }) {
  return (
    <div style={{ marginBottom:"14px" }}>
      <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px",letterSpacing:"0.05em" }}>{label}</p>
      {multiline ? (
        <textarea value={form[fkey]||""} onChange={e=>setForm(p=>({...p,[fkey]:e.target.value}))}
          placeholder={placeholder} rows={3}
          style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
            border:`1px solid ${T.border}`,backgroundColor:T.bg,
            fontSize:"11px",color:T.text,outline:"none",resize:"vertical",
            boxSizing:"border-box",fontFamily:"inherit" }}/>
      ) : (
        <input type={type||"text"} value={form[fkey]||""} onChange={e=>setForm(p=>({...p,[fkey]:e.target.value}))}
          placeholder={placeholder}
          style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
            border:`1px solid ${T.border}`,backgroundColor:T.bg,
            fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
      )}
    </div>
  );
}

// 密码字段：带显示/隐藏（Token / Key 通用）
function SecretField({ label, fkey, placeholder, form, setForm }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom:"14px" }}>
      <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px",letterSpacing:"0.05em" }}>{label}</p>
      <div style={{ position:"relative" }}>
        <input type={show?"text":"password"} value={form[fkey]||""}
          onChange={e=>setForm(p=>({...p,[fkey]:e.target.value}))}
          placeholder={placeholder} autoComplete="off"
          style={{ width:"100%",padding:"9px 38px 9px 11px",borderRadius:T.radiusSm,
            border:`1px solid ${T.border}`,backgroundColor:T.bg,
            fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
        <button onClick={()=>setShow(v=>!v)} style={{
          position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)",
          background:"none",border:"none",cursor:"pointer",padding:"2px",
          color:T.textMuted,fontSize:"14px",lineHeight:1 }}>{show?"🙈":"👁"}</button>
      </div>
    </div>
  );
}

// 接口预设：把一组接口配置存成命名预设，一键切换。列表里只显示名称，不显示地址/密钥。
function ConfigPresets({ presetsKey, keys, form, setForm, commit }) {
  const [name, setName] = useState("");
  const list = form[presetsKey] || [];
  const isActive = (p) => keys.every(k => String(form[k] ?? "") === String(p.data[k] ?? ""));
  const savePreset = () => {
    const nm = name.trim(); if (!nm) return;
    const data = {}; keys.forEach(k => { data[k] = form[k] ?? ""; });
    const exists = list.some(p => p.name === nm);
    const next = exists
      ? list.map(p => p.name === nm ? { ...p, data } : p)
      : [...list, { id:Date.now().toString(), name:nm, data }];
    commit({ ...form, [presetsKey]:next });
    setName("");
  };
  const apply = (p) => commit({ ...form, ...p.data });
  const remove = (id) => commit({ ...form, [presetsKey]:list.filter(p => p.id !== id) });
  return (
    <div style={{ marginBottom:"14px",padding:"10px",borderRadius:T.radiusSm,
      border:`1px dashed ${T.border}`,backgroundColor:T.bg }}>
      <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 8px",letterSpacing:"0.05em" }}>接口预设</p>
      {list.length > 0 && (
        <div style={{ display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"8px" }}>
          {list.map(p=>(
            <div key={p.id} style={{ display:"flex",alignItems:"center",borderRadius:"14px",overflow:"hidden",
              border:`1px solid ${isActive(p)?T.accent:T.border}`,
              backgroundColor:isActive(p)?T.accent:T.surface }}>
              <button onClick={()=>apply(p)} style={{ padding:"5px 10px",border:"none",background:"none",
                fontSize:"11px",cursor:"pointer",color:isActive(p)?"#fff":T.textSub }}>{p.name}</button>
              <button onClick={()=>remove(p.id)} style={{ padding:"5px 8px 5px 0",border:"none",background:"none",
                fontSize:"12px",cursor:"pointer",color:isActive(p)?"rgba(255,255,255,0.7)":T.textMuted }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display:"flex",gap:"6px" }}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="给当前配置起个名字"
          style={{ flex:1,padding:"7px 10px",borderRadius:T.radiusXs,border:`1px solid ${T.border}`,
            backgroundColor:T.surface,fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
        <Btn onClick={savePreset} disabled={!name.trim()} variant="soft" style={{ fontSize:"11px",padding:"7px 12px" }}>保存为预设</Btn>
      </div>
    </div>
  );
}

const NAI_KEYS = ["naiProxyUrl","naiToken","naiModel","naiSampler","naiNoiseSchedule","naiSteps","naiScale","naiCfg","naiSize"];
const GPT_KEYS = ["gptBaseUrl","gptApiKey","gptModel","gptSize"];
const LLM_KEYS = ["llmMode","llmBaseUrl","llmApiKey","llmModel","llmTemperature","llmMaxTokens","llmStream"];

function SettingsPage({ settings, setSettings }) {
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [editingPreset, setEditingPreset] = useState(null);
  const [editingPresetData, setEditingPresetData] = useState(null); // {id,name,tags}
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetTags, setNewPresetTags] = useState("");

  const save = () => {
    setSettings(form);
    saveSettings(form);
    setSaved(true);
    setTimeout(()=>setSaved(false),1800);
  };

  // 立即保存并生效（预设的保存/应用/删除用）
  const commit = (next) => { setForm(next); setSettings(next); saveSettings(next); };

  const addPreset = () => {
    if (!newPresetName.trim()) return;
    const id = Date.now().toString();
    const preset = { id, name:newPresetName.trim(), tags:newPresetTags.trim() };
    setForm(p=>({ ...p, artistPresets:[...(p.artistPresets||[]),preset], activePreset:id }));
    setNewPresetName(""); setNewPresetTags(""); setEditingPreset(null);
  };

  const deletePreset = (id) => {
    setForm(p=>({ ...p, artistPresets:(p.artistPresets||[]).filter(pr=>pr.id!==id),
      activePreset:p.activePreset===id?null:p.activePreset }));
  };

  const [modelList, setModelList] = useState([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchStatus, setModelFetchStatus] = useState(""); // "" | "ok" | "err"

  const fetchModels = async () => {
    const baseUrl = (form.llmBaseUrl||"").replace(/\/$/, "");
    const apiKey = form.llmApiKey||"";
    if (!baseUrl || !apiKey) { setModelFetchStatus("err"); setModelList([]); return; }
    setFetchingModels(true); setModelFetchStatus("");
    try {
      const resp = await fetch(`${baseUrl}/v1/models`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      const data = await resp.json();
      const ids = (data.data||[]).map(m=>m.id).filter(Boolean).sort();
      setModelList(ids);
      setModelFetchStatus(ids.length>0?"ok":"err");
      if (ids.length>0 && !form.llmModel) setForm(p=>({...p,llmModel:ids[0]}));
    } catch {
      setModelFetchStatus("err"); setModelList([]);
    }
    setFetchingModels(false);
  };



  return (
    <div style={{ overflowY:"auto",padding:"16px",height:"100%",boxSizing:"border-box" }}>

      <SettingsSection title="NAI 生图">
        <ConfigPresets presetsKey="naiPresets" keys={NAI_KEYS} form={form} setForm={setForm} commit={commit}/>
        <SettingsField form={form} setForm={setForm} label="接口地址 URL" fkey="naiProxyUrl" placeholder="https://…/api/generate"/>
        <SecretField form={form} setForm={setForm} label="Token" fkey="naiToken" placeholder="粘贴 Token"/>
        <SettingsField form={form} setForm={setForm} label="模型" fkey="naiModel" placeholder="nai-diffusion-4-5-full"/>
        <div style={{ display:"flex",gap:"10px",marginBottom:"14px" }}>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>采样器</p>
            <select value={form.naiSampler||"k_dpmpp_2m"} onChange={e=>setForm(p=>({...p,naiSampler:e.target.value}))}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none" }}>
              {["k_dpmpp_2m","k_euler_ancestral","k_euler","k_dpmpp_sde","k_dpmpp_2s_ancestral"].map(s=>(
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>Noise Schedule</p>
            <select value={form.naiNoiseSchedule||"karras"} onChange={e=>setForm(p=>({...p,naiNoiseSchedule:e.target.value}))}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none" }}>
              {["karras","exponential","polyexponential","native"].map(s=>(
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display:"flex",gap:"10px",marginBottom:"14px" }}>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>Steps</p>
            <input type="number" value={form.naiSteps||"28"} onChange={e=>setForm(p=>({...p,naiSteps:e.target.value}))}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>Scale（引导强度）</p>
            <input type="number" value={form.naiScale||"5"} onChange={e=>setForm(p=>({...p,naiScale:e.target.value}))}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>CFG Rescale</p>
            <input type="number" value={form.naiCfg||"0"} step="0.1" onChange={e=>setForm(p=>({...p,naiCfg:e.target.value}))}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
          </div>
        </div>
        <div style={{ marginBottom:"14px" }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>尺寸预设</p>
          <select value={form.naiSize||"竖图"}
            onChange={e=>setForm(p=>({...p,naiSize:e.target.value}))}
            style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
              border:`1px solid ${T.border}`,backgroundColor:T.bg,
              fontSize:"11px",color:T.text,outline:"none" }}>
            {["竖图","横图","方图","768x1344(高竖图)","896x1152"].map(s=>(
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <SettingsField form={form} setForm={setForm} label="Negative Prompt" fkey="negative"
          placeholder="lowres, worst quality, bad anatomy, text, watermark…" multiline/>
      </SettingsSection>

      <SettingsSection title="GPT 生图（第三方）">
        <ConfigPresets presetsKey="gptPresets" keys={GPT_KEYS} form={form} setForm={setForm} commit={commit}/>
        <SettingsField form={form} setForm={setForm} label="接口地址 URL" fkey="gptBaseUrl" placeholder="https://…"/>
        <SecretField form={form} setForm={setForm} label="API Key" fkey="gptApiKey" placeholder="粘贴 API Key"/>
        <SettingsField form={form} setForm={setForm} label="模型" fkey="gptModel" placeholder="gpt-image-1"/>
        <div style={{ marginBottom:"14px" }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>尺寸</p>
          <select value={form.gptSize||"1024x1536"} onChange={e=>setForm(p=>({...p,gptSize:e.target.value}))}
            style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
              border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none" }}>
            {["1024x1536","1024x1024","1536x1024"].map(s=>(<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
      </SettingsSection>

      <SettingsSection title="画师串预设">
        {(form.artistPresets||[]).map(preset=>(
          <div key={preset.id} style={{ marginBottom:"8px" }}>
            {editingPreset===preset.id ? (
              /* 编辑模式 */
              <div style={{ padding:"12px",border:`1px solid ${T.accent}`,borderRadius:T.radiusSm,
                backgroundColor:"#fff" }}>
                <input value={editingPresetData?.name||""} onChange={e=>setEditingPresetData(p=>({...p,name:e.target.value}))}
                  placeholder="预设名称" style={{ width:"100%",padding:"7px 10px",borderRadius:T.radiusXs,
                    marginBottom:"8px",border:`1px solid ${T.border}`,backgroundColor:T.bg,
                    fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
                <textarea value={editingPresetData?.tags||""} onChange={e=>setEditingPresetData(p=>({...p,tags:e.target.value}))}
                  placeholder="画师串 tag，逗号分隔…" rows={4}
                  style={{ width:"100%",padding:"7px 10px",borderRadius:T.radiusXs,marginBottom:"8px",
                    border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",
                    color:T.text,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit" }}/>
                <div style={{ display:"flex",gap:"8px" }}>
                  <Btn onClick={()=>{
                    setForm(p=>({...p,artistPresets:p.artistPresets.map(pr=>
                      pr.id===preset.id?{...pr,...editingPresetData}:pr)}));
                    setEditingPreset(null); setEditingPresetData(null);
                  }} style={{ flex:1,fontSize:"11px",padding:"7px" }}>保存修改</Btn>
                  <Btn onClick={()=>{setEditingPreset(null);setEditingPresetData(null);}}
                    variant="ghost" style={{ fontSize:"11px",padding:"7px" }}>取消</Btn>
                </div>
              </div>
            ) : (
              /* 显示模式 */
              <div style={{ padding:"10px 12px",borderRadius:T.radiusSm,
                border:`1px solid ${form.activePreset===preset.id?T.accent:T.border}`,
                backgroundColor:form.activePreset===preset.id?"#fff":T.bg,cursor:"pointer" }}
                onClick={()=>setForm(p=>({...p,activePreset:preset.id}))}>
                <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
                  <span style={{ fontSize:"11px",fontWeight:"600",color:T.text,flex:1 }}>{preset.name}</span>
                  {form.activePreset===preset.id && <span style={{ fontSize:"9px",color:T.accent,
                    backgroundColor:T.accentSoft,padding:"1px 6px",borderRadius:"8px" }}>启用</span>}
                  <button onClick={e=>{e.stopPropagation();
                    setEditingPreset(preset.id);setEditingPresetData({name:preset.name,tags:preset.tags});}}
                    style={{ background:"none",border:"none",color:T.textMuted,cursor:"pointer",
                      fontSize:"12px",padding:"2px 4px" }}>编辑</button>
                  <button onClick={e=>{e.stopPropagation();deletePreset(preset.id);}} style={{
                    background:"none",border:"none",color:T.textMuted,cursor:"pointer",
                    fontSize:"14px",padding:"2px" }}>×</button>
                </div>
                <p style={{ fontSize:"10px",color:T.textMuted,margin:"4px 0 0",lineHeight:1.4,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  {preset.tags||"（空）"}
                </p>
              </div>
            )}
          </div>
        ))}
        {/* 新增预设 */}
        {editingPreset==="new" ? (
          <div style={{ padding:"12px",border:`1px dashed ${T.border}`,borderRadius:T.radiusSm,marginTop:"8px" }}>
            <input value={newPresetName} onChange={e=>setNewPresetName(e.target.value)}
              placeholder="预设名称（如：低饱和厚涂）"
              style={{ width:"100%",padding:"7px 10px",borderRadius:T.radiusXs,marginBottom:"8px",
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",
                color:T.text,outline:"none",boxSizing:"border-box" }}/>
            <textarea value={newPresetTags} onChange={e=>setNewPresetTags(e.target.value)}
              placeholder="画师串 tag，逗号分隔…" rows={3}
              style={{ width:"100%",padding:"7px 10px",borderRadius:T.radiusXs,marginBottom:"8px",
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",
                color:T.text,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit" }}/>
            <div style={{ display:"flex",gap:"8px" }}>
              <Btn onClick={addPreset} style={{ flex:1 }}>保存</Btn>
              <Btn onClick={()=>setEditingPreset(null)} variant="ghost" style={{ flex:1 }}>取消</Btn>
            </div>
          </div>
        ) : (
          <button onClick={()=>setEditingPreset("new")} style={{
            width:"100%",padding:"9px",borderRadius:T.radiusSm,marginTop:"8px",
            border:`1.5px dashed ${T.border}`,backgroundColor:"transparent",
            fontSize:"11px",color:T.textMuted,cursor:"pointer" }}>+ 新增画师串预设</button>
        )}
      </SettingsSection>

      <SettingsSection title="文字 AI">
        <ConfigPresets presetsKey="llmPresets" keys={LLM_KEYS} form={form} setForm={setForm} commit={commit}/>
        {/* 接口模式切换 */}
        <div style={{ marginBottom:"14px" }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 6px",letterSpacing:"0.05em" }}>接口类型</p>
          <div style={{ display:"flex",gap:"6px" }}>
            {[{val:"anthropic",label:"Anthropic 原生"},{val:"openai",label:"OpenAI 兼容（第三方）"}].map(opt=>(
              <button key={opt.val} onClick={()=>setForm(p=>({...p,llmMode:opt.val}))}
                style={{ flex:1,padding:"8px",borderRadius:T.radiusSm,border:"none",
                  fontSize:"11px",cursor:"pointer",
                  backgroundColor:form.llmMode===opt.val||(!form.llmMode&&opt.val==="anthropic")?T.accent:T.accentSoft,
                  color:form.llmMode===opt.val||(!form.llmMode&&opt.val==="anthropic")?"#fff":T.textSub }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* OpenAI兼容模式额外字段 */}
        {(form.llmMode==="openai") && (
          <>
            <SettingsField form={form} setForm={setForm} label="Base URL" fkey="llmBaseUrl" placeholder="https://api.openai.com 或第三方地址"/>
            <SecretField form={form} setForm={setForm} label="API Key" fkey="llmApiKey" placeholder="粘贴 API Key"/>
          </>
        )}

        {/* 模型名：OpenAI模式下可拉取列表 */}
        <div style={{ marginBottom:"14px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px" }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:0,letterSpacing:"0.05em",flex:1 }}>模型名</p>
            {form.llmMode==="openai" && (
              <button onClick={fetchModels} disabled={fetchingModels} style={{
                padding:"3px 8px",borderRadius:"6px",border:`1px solid ${T.border}`,
                backgroundColor:T.bg,fontSize:"10px",color:T.textSub,cursor:"pointer",
              }}>
                {fetchingModels?"拉取中…":"拉取模型列表"}
              </button>
            )}
            {modelFetchStatus==="ok" && <span style={{ fontSize:"10px",color:"#5a8a5a" }}>✓ {modelList.length}个</span>}
            {modelFetchStatus==="err" && <span style={{ fontSize:"10px",color:T.warn }}>✗ 失败</span>}
          </div>
          {modelList.length>0 && form.llmMode==="openai" ? (
            <select value={form.llmModel||""}
              onChange={e=>setForm(p=>({...p,llmModel:e.target.value}))}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,
                fontSize:"11px",color:T.text,outline:"none" }}>
              {modelList.map(id=><option key={id} value={id}>{id}</option>)}
            </select>
          ) : (
            <input value={form.llmModel||""} onChange={e=>setForm(p=>({...p,llmModel:e.target.value}))}
              placeholder={form.llmMode==="openai"?"gpt-4o / deepseek-chat / …":"claude-sonnet-4-6"}
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,
                fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
          )}
        </div>
        <div style={{ display:"flex",gap:"10px",marginBottom:"14px" }}>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>温度 Temperature</p>
            <input type="number" step="0.1" min="0" max="2" value={form.llmTemperature??""}
              onChange={e=>setForm(p=>({...p,llmTemperature:e.target.value}))} placeholder="0.7"
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px" }}>Token 上限</p>
            <input type="number" min="1" value={form.llmMaxTokens??""}
              onChange={e=>setForm(p=>({...p,llmMaxTokens:e.target.value}))} placeholder="1500"
              style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
          </div>
        </div>
        <div style={{ marginBottom:"14px" }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 6px",letterSpacing:"0.05em" }}>流式输出</p>
          <div style={{ display:"flex",gap:"6px" }}>
            {[{v:true,l:"开"},{v:false,l:"关"}].map(o=>(
              <button key={o.l} onClick={()=>setForm(p=>({...p,llmStream:o.v}))}
                style={{ flex:1,padding:"8px",borderRadius:T.radiusSm,border:"none",fontSize:"11px",cursor:"pointer",
                  backgroundColor:!!form.llmStream===o.v?T.accent:T.accentSoft,
                  color:!!form.llmStream===o.v?"#fff":T.textSub }}>{o.l}</button>
            ))}
          </div>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"6px 0 0",lineHeight:1.5 }}>
            部分第三方接口不支持流式，遇到报错请关闭。
          </p>
        </div>
        <SettingsField form={form} setForm={setForm} label="审美偏好描述（辅助prompt生成）" fkey="aestheticDesc"
          placeholder="如：日系街拍、宽松廓形、低饱和莫兰迪色系…" multiline/>
      </SettingsSection>

      <SettingsSection title="图片存储">
        <div style={{ marginBottom:"10px" }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px",letterSpacing:"0.05em" }}>生成图保留期限</p>
          <select value={form.poolRetention||"1m"} onChange={e=>setForm(p=>({...p,poolRetention:e.target.value}))}
            style={{ width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,
              border:`1px solid ${T.border}`,backgroundColor:T.bg,
              fontSize:"11px",color:T.text,outline:"none" }}>
            <option value="1w">保留一周</option>
            <option value="1m">保留一个月</option>
            <option value="forever">永久保留</option>
          </select>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"6px 0 0",lineHeight:1.5 }}>
            原图存在浏览器 IndexedDB（刷新不丢、全分辨率）。超过期限的图会在下次打开时自动清理。衣橱里可「打包下载」为 zip。
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Char 角色卡 & 记忆">
        <SettingsField form={form} setForm={setForm} label="角色设定（JSON或纯文本）" fkey="charCard" placeholder="粘贴角色卡内容…" multiline/>
        <SettingsField form={form} setForm={setForm} label="偏好记忆" fkey="memory"
          placeholder="宽松廓形 / 不喜欢高饱和红 / 倾向方案B…" multiline/>
      </SettingsSection>

      <button onClick={save} style={{ width:"100%",padding:"11px",borderRadius:T.radiusSm,
        border:"none",backgroundColor:saved?"#5a8a5a":T.accent,
        color:"#fff",fontSize:"12px",fontWeight:"500",cursor:"pointer",
        transition:"background 0.2s",marginBottom:"24px" }}>
        {saved?"✓ 已保存":"保存配置"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 主 App
// ═══════════════════════════════════════════════════════
const SETTINGS_KEY = "wardrobe_settings_v1";
const DEFAULT_SETTINGS = {
  // 接口地址默认留空：别人打开页面时不会看到任何预填地址，自己的配置存成命名预设
  naiToken:"", naiProxyUrl:"",
  naiModel:"nai-diffusion-4-5-full", naiSize:"竖图",
  naiSampler:"k_dpmpp_2m", naiNoiseSchedule:"karras",
  naiScale:"5", naiSteps:"28", naiCfg:"0",
  negative:"lowres, worst quality, bad anatomy, text, watermark, signature",
  artistPresets:[], activePreset:null,
  gptBaseUrl:"", gptApiKey:"", gptModel:"gpt-image-1", gptSize:"1024x1536",
  naiPresets:[], gptPresets:[], llmPresets:[],
  llmMode:"anthropic", llmBaseUrl:"", llmApiKey:"", llmModel:"claude-sonnet-4-6",
  llmTemperature:"0.7", llmMaxTokens:"1500", llmStream:false,
  aestheticDesc:"", charCard:"", memory:"",
  poolRetention:"1m", // 衣橱生成图保留期限：1w / 1m / forever
};
function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
const POOL_KEY = "wardrobe_pool_v1";

// ═══ IndexedDB：存生成图原图（全分辨率，不压缩，刷新不丢）═══
const IDB_NAME = "wardrobeDB", IDB_STORE = "images";
function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath:"id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbPut(id, dataUrl, savedAt) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ id, dataUrl, savedAt });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(id);
    r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
  });
}
async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
async function idbGetAllKeys() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).getAllKeys();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// 仅读元数据（同步，给 useState 初始化用，图片随后异步补上）
function loadPool() {
  try {
    const s = localStorage.getItem(POOL_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

// 保留期限清理：删掉超过期限的原图 + 对应元数据
const RETENTION_MS = { "1w": 7*86400000, "1m": 30*86400000 };
async function cleanupExpiredImages(retention) {
  if (!retention || retention === "forever") return;
  const span = RETENTION_MS[retention]; if (!span) return;
  const cutoff = Date.now() - span;
  try {
    const all = await idbGetAll();
    const expired = all.filter(r => (r.savedAt || 0) < cutoff).map(r => r.id);
    if (!expired.length) return;
    for (const id of expired) { try { await idbDelete(id); } catch {} }
    const meta = loadPool().filter(i => !expired.includes(i.id));
    localStorage.setItem(POOL_KEY, JSON.stringify(meta.map(({dataUrl, ...r}) => r)));
    console.log(`[retention] 清理过期图 ${expired.length} 张`);
  } catch (e) { console.warn("retention清理失败:", e); }
}

// 把元数据列表补上 IndexedDB 里的原图（异步）；顺带迁移旧版缩略图
async function hydratePoolImages(metaList) {
  const out = [];
  for (const item of metaList) {
    let dataUrl = null;
    try { dataUrl = (await idbGet(item.id))?.dataUrl || null; } catch {}
    if (!dataUrl) {
      try {
        const old = localStorage.getItem(`pool_img_${item.id}`);
        if (old) { dataUrl = old; await idbPut(item.id, old, item.savedAt || item.id || Date.now()); }
      } catch {}
    }
    out.push({ ...item, dataUrl });
  }
  return out;
}
// 压缩图片到合理尺寸再存（避免localStorage超限导致黑图）
async function compressImage(dataUrl, maxW=400, maxH=600, quality=0.75) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW/img.width, maxH/img.height);
      const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
      const canvas = document.createElement("canvas");
      canvas.width=w; canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      res(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}
function savePool(pool) {
  // 元数据存 localStorage（同步、保序、刷新后布局立刻在）
  try {
    const slim = pool.map(({dataUrl, ...rest}) => ({
      ...rest, savedAt: rest.savedAt || rest.id || Date.now(),
    }));
    localStorage.setItem(POOL_KEY, JSON.stringify(slim));
  } catch(e) { console.warn("savePool元数据失败:", e); }

  // 原图（全分辨率 dataUrl）存 IndexedDB，不压缩
  pool.forEach(item => {
    if (item.dataUrl) {
      idbPut(item.id, item.dataUrl, item.savedAt || item.id || Date.now())
        .catch(e => console.warn("idbPut失败:", e));
    }
  });

  // 协调删除：IDB 里不在当前 pool 的图清掉（处理手动删除的项）
  idbGetAllKeys().then(keys => {
    const valid = new Set(pool.map(i => i.id));
    keys.forEach(k => { if (!valid.has(k)) idbDelete(k).catch(()=>{}); });
  }).catch(()=>{});
}
// 同步返回元数据（dataUrl 先为 null）；原图由 App 挂载后 hydratePoolImages 异步补上
function loadPoolWithImages() {
  return loadPool().map(item => ({ ...item, dataUrl: null }));
}

// 材料区存储
const MATERIALS_KEY = "wardrobe_materials_v1";
function saveMaterials(materials) {
  try {
    const slim = materials.map(({dataUrl, ...rest}) => rest);
    localStorage.setItem(MATERIALS_KEY, JSON.stringify(slim));
    materials.slice(0, 50).forEach(item => {
      if (item.dataUrl) {
        compressImage(item.dataUrl, 300, 400, 0.7).then(compressed => {
          try { localStorage.setItem(`mat_img_${item.id}`, compressed); } catch(e) {
            console.warn("材料图存储失败:", e.message);
          }
        });
      }
    });
  } catch(e) { console.warn("saveMaterials失败:", e); }
}
function loadMaterials() {
  try {
    const s = localStorage.getItem(MATERIALS_KEY);
    const list = s ? JSON.parse(s) : [];
    return list.map(item => ({
      ...item,
      dataUrl: (() => { try { return localStorage.getItem(`mat_img_${item.id}`) || null; } catch { return null; } })(),
    }));
  } catch { return []; }
}

export default function App() {
  const [tab, setTab] = useState("generate");
  const [homeSignal, setHomeSignal] = useState(0);
  const [genPool, setGenPool] = useState(loadPoolWithImages);
  const [settings, setSettings] = useState(loadSettings);

  // 挂载后：按保留期限清理过期图，再从 IndexedDB 把原图补回内存
  useEffect(() => {
    (async () => {
      await cleanupExpiredImages(settings.poolRetention || "1m");
      const withImages = await hydratePoolImages(loadPool());
      setGenPool(withImages);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 搭配页自己保存输入与结果（组件不卸载，tab 切换不丢）；这里只保留跨页共享的部分
  const [chatMessages, setChatMessages] = useState([]); // 对话历史跨tab保留
  const [materials, setMaterials] = useState(loadMaterials); // 材料区，持久化

  const handleSaveToWardrobe = (img) => {
    setGenPool(prev => {
      const next = [img, ...prev];
      savePool(next);
      return next;
    });
  };

  const handleUpdateMemory = (newMemory) => {
    setSettings(prev=>{
      const next = {...prev, memory:newMemory};
      saveSettings(next);
      return next;
    });
  };

  const handleRegenerate = (item) => {
    setTab("generate");
    // 如果带有overrideTag，切换后直接用该tag重新生成
    if (item?.overrideTag) {
      // 把overrideTag暂存，GeneratePage mount后触发
      setTimeout(() => {
        // GeneratePage通过ref或event触发，这里简化：提示用户手动点
        // 完整实现需要ref传递，后续可改
      }, 100);
    }
  };

  const handleAddMaterial = (item) => {
    setMaterials(prev => {
      if (prev.find(m => m.name === item.name && m.savedAt === item.savedAt)) return prev;
      const next = [item, ...prev];
      saveMaterials(next);
      return next;
    });
  };

  // 顶部图标：回到搭配首页并滚到顶部
  const goHome = () => { setTab("generate"); setHomeSignal(n => n + 1); };

  const TABS = [
    { key:"generate", label:"搭配", icon:"✦" },
    { key:"wardrobe", label:"衣橱", icon:"⊞" },
    { key:"settings", label:"设置", icon:"⚙" },
  ];

  return (
    <div style={{ height:"100vh",display:"flex",flexDirection:"column",
      backgroundColor:T.bg,
      fontFamily:"-apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
      maxWidth:"480px",margin:"0 auto" }}>

      {/* Header：只放图标，点击回到首页 */}
      <div style={{ padding:"8px 16px",borderBottom:`1px solid ${T.border}`,
        backgroundColor:T.surface,flexShrink:0,display:"flex",alignItems:"center" }}>
        <button onClick={goHome} aria-label="回到搭配首页" title="回到搭配首页" style={{
          background:"none",border:"none",padding:"4px",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={T.text}
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V7.2a2.2 2.2 0 1 0-2.2-2.2"/>
            <path d="M12 8 3.3 14.4a1.6 1.6 0 0 0 .95 2.9h15.5a1.6 1.6 0 0 0 .95-2.9L12 8Z"/>
          </svg>
        </button>
      </div>

      {/* 内容：用display:none切换，保持组件不卸载，state不丢 */}
      <div style={{ flex:1,overflow:"hidden",display:"flex",flexDirection:"column" }}>
        <div style={{ display:tab==="generate"?"flex":"none", flexDirection:"column", flex:1, overflow:"hidden" }}>
          <GeneratePage
            settings={settings} onSaveToWardrobe={handleSaveToWardrobe} onUpdateMemory={handleUpdateMemory}
            onAddMaterial={handleAddMaterial}
            chatMessages={chatMessages} setChatMessages={setChatMessages}
            homeSignal={homeSignal}
          />
        </div>
        <div style={{ display:tab==="wardrobe"?"flex":"none", flexDirection:"column", flex:1, overflow:"hidden" }}>
          <WardrobePage genPool={genPool} setGenPool={setGenPool}
            materials={materials} setMaterials={setMaterials}
            settings={settings} onRegenerate={handleRegenerate}/>
        </div>
        <div style={{ display:tab==="settings"?"flex":"none", flexDirection:"column", flex:1, overflow:"hidden" }}>
          <SettingsPage settings={settings} setSettings={setSettings}/>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display:"flex",borderTop:`1px solid ${T.border}`,
        backgroundColor:T.surface,flexShrink:0 }}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{
            flex:1,padding:"10px 0 12px",border:"none",background:"none",
            display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",cursor:"pointer" }}>
            <span style={{ fontSize:"16px",color:tab===t.key?T.accent:T.textMuted,transition:"color 0.15s" }}>{t.icon}</span>
            <span style={{ fontSize:"10px",fontWeight:tab===t.key?"600":"400",
              color:tab===t.key?T.accent:T.textMuted,transition:"color 0.15s" }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
