import { useState, useCallback, useRef, useEffect } from "react";

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
// ═══════════════════════════════════════════════════════
async function callLLM({ settings, system, userContent, maxTokens = 1000, imageBase64 = null, imageMime = "image/jpeg" }) {
  const mode = settings.llmMode || "anthropic";
  const model = settings.llmModel || "claude-sonnet-4-6";

  if (mode === "openai") {
    // OpenAI 兼容格式（Gemini Flash等）
    // Gemini兼容接口system role支持不稳定，把system内容合并进user消息更可靠
    const baseUrl = (settings.llmBaseUrl || "https://api.openai.com").replace(/\/$/, "");
    const apiKey = settings.llmApiKey || "";
    const msgs = [];
    // system内容合并到第一条user消息前
    const fullUserContent = system ? `${system}

---
${userContent}` : userContent;
    if (imageBase64) {
      msgs.push({ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
        { type: "text", text: fullUserContent },
      ]});
    } else {
      msgs.push({ role: "user", content: fullUserContent });
    }
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: msgs }),
    });
    const data = await resp.json();
    console.log("[callLLM OpenAI] status:", resp.status, "choices:", data.choices?.length, "error:", data.error);
    return data.choices?.[0]?.message?.content || "";
  } else {
    // Anthropic 原生格式（支持vision）
    const userMsg = imageBase64
      ? [
          { type: "image", source: { type: "base64", media_type: imageMime, data: imageBase64 } },
          { type: "text", text: userContent },
        ]
      : userContent;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await resp.json();
    return data.content?.[0]?.text || "";
  }
}

// 多轮对话版（对话弹窗用，需要传完整历史）
async function callLLMChat({ settings, system, messages, maxTokens = 1000 }) {
  const mode = settings.llmMode || "anthropic";
  const model = settings.llmModel || "claude-sonnet-4-6";

  if (mode === "openai") {
    const baseUrl = (settings.llmBaseUrl || "https://api.openai.com").replace(/\/$/, "");
    const apiKey = settings.llmApiKey || "";
    const msgs = [...messages];
    // system合并进第一条user消息
    if (system && msgs.length > 0 && msgs[0].role === "user") {
      msgs[0] = { ...msgs[0], content: `${system}

---
${msgs[0].content}` };
    } else if (system) {
      msgs.unshift({ role: "system", content: system });
    }
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: msgs }),
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";
  } else {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages,
      }),
    });
    const data = await resp.json();
    return data.content?.[0]?.text || "";
  }
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
// 搭配页
// ═══════════════════════════════════════════════════════
function GeneratePage({ settings, onSaveToWardrobe, onUpdateMemory, onAddMaterial, chatMessages, setChatMessages,
  step, setStep, uploadedImg, setUploadedImg,
  extractedColors, setExtractedColors,
  selectedColor, setSelectedColor,
  selectedSkin, setSelectedSkin,
  schemes, setSchemes,
  selectedScheme, setSelectedScheme,
  generating, setGenerating,
  genProgress, setGenProgress,
  resultImg, setResultImg,
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState("");
  const fileRef = useRef(null);
  const resultRef = useRef(null);

  // 生图成功后自动滚到结果区
  useEffect(() => {
    if (resultImg && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [resultImg]);

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
      setSchemes([]); setSelectedScheme(null); setResultImg(null);
      setStep("colors");
      // 自动同步到材料区
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
      const hsl = { h: c.hsl.h, s: c.hsl.s, l };
      return { hex: toHex(hsl.h, hsl.s, hsl.l), hsl, ...hexToRgb(toHex(hsl.h, hsl.s, hsl.l)), cnt: 100 };
    });
    setUploadedImg({ url: null, mockName: outfit.name });
    setExtractedColors(colors);
    setSelectedColor(colors[0]);
    setSchemes([]); setSelectedScheme(null); setResultImg(null);
    setStep("colors");
  };

  const handleAnalyze = () => {
    if (!selectedColor || !selectedSkin) return;
    const mainColor = selectedColor.hsl;
    const computed = matchSchemes(mainColor, selectedSkin);
    setSchemes(computed); setSelectedScheme(computed[0]);
    setStep("scheme");
  };

  // 文字AI生成NAI prompt（含读图 + 结构化配色）
  const buildPromptViaAI = async (scheme, mainColor) => {
    const artistPre = settings.artistPresets?.find(p=>p.id===settings.activePreset);
    const artistTags = artistPre ? artistPre.tags : "";
    const negTags = settings.negative || "";

    // 结构化色块文本
    const skinRef = selectedSkin || { hex:"#F0E0C8", label:"自然白", isWarm:false };
    const colorStructure = schemeToStructuredText(scheme, skinRef);

    // 读图：把上传的衣服图转base64
    let imageBase64 = null;
    let imageMime = "image/jpeg";
    if (uploadedImg?.url && !uploadedImg.mockName) {
      try {
        const imgResp = await fetch(uploadedImg.url);
        const blob = await imgResp.blob();
        imageMime = blob.type || "image/jpeg";
        imageBase64 = await new Promise(res => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result.split(",")[1]);
          fr.readAsDataURL(blob);
        });
      } catch { imageBase64 = null; }
    }

    // 把色块直接转成颜色描述词，硬编码保证一定出现
    const hslToColorName = (h, s, l) => {
      if (s < 12) return l > 70 ? "light gray" : l > 40 ? "gray" : "dark gray";
      if (l > 85) return "off-white"; if (l < 20) return "near-black";
      const names = [[15,"red"],[40,"orange"],[65,"yellow"],[80,"yellow-green"],
        [150,"green"],[175,"teal"],[200,"sky blue"],[240,"blue"],[270,"purple"],
        [300,"violet"],[330,"pink"],[360,"red"]];
      const hue = names.find(([deg]) => h <= deg)?.[1] || "neutral";
      const lt = l > 70 ? "light " : l < 35 ? "dark " : "";
      const sat = s < 30 ? "muted " : s > 70 ? "vivid " : "";
      return `${lt}${sat}${hue}`.trim();
    };
    const hexToHSL2 = (hex) => {
      let r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
      const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
      if(max===min) return {h:0,s:0,l:Math.round(l*100)};
      const d=max-min, s=l>0.5?d/(2-max-min):d/(max+min);
      let h=0;
      if(max===r) h=((g-b)/d+(g<b?6:0))/6;
      else if(max===g) h=((b-r)/d+2)/6;
      else h=((r-g)/d+4)/6;
      return {h:Math.round(h*360),s:Math.round(s*100),l:Math.round(l*100)};
    };
    // 从色块提取颜色描述
    const toName = (hex) => { const {h,s,l}=hexToHSL2(hex); return hslToColorName(h,s,l); };
    // 按顺序分配：跳过肤色和参考色，按实际色块顺序分配单品
    const usableColors = selectedScheme.colors.filter(c=>c.size!=="lg"&&!c.isRef);
    const garmentSlots = ["top","pants","sneakers","bag","accessory"];
    const mandatoryColorTags = usableColors.slice(0,5).map((c,i) =>
      `${toName(c.hex)} ${garmentSlots[i]||"accessory"}`
    ).join(", ");
    console.log("[mandatoryColorTags]", mandatoryColorTags);

    const sys = `You are a NovelAI fashion prompt writer.
I will give you mandatory color+garment tags. Your job is to EXPAND them into a full outfit description.
Add: specific garment style (hoodie/coat/skirt/jeans etc), silhouette (oversized/fitted/high-waisted), material (cotton/denim/knit), styling details, and required base tags.
Do NOT change the colors. Output ONLY a comma-separated English tag string, 25-40 tags total.
Required base tags to include: 1girl, full body, standing, white background, fashion photography, real clothing, everyday wear, street fashion
NO fantasy, NO gown, NO ancient costume.`;

    const mainHex = selectedColor?.hex || "";
    const userMsg = `Mandatory outfit tags (DO NOT change these colors): ${mandatoryColorTags}
${imageBase64 ? "Reference image shows the main garment style — keep the silhouette, expand the outfit." : ""}
User style preference: ${settings.aestheticDesc||"casual everyday"}
Expand into a full 25-40 tag NAI prompt string:`;

    const rawAiTags = (await callLLM({
      settings,
      system: sys,
      userContent: userMsg,
      maxTokens: 800,
      imageBase64,
      imageMime,
    })).trim();
    console.log("[buildPromptViaAI] AI完整返回:", rawAiTags);
    setGenProgress(rawAiTags ? `AI: ${rawAiTags.slice(0,80)}…` : "⚠️ AI返回为空");
    await new Promise(r=>setTimeout(r,2000));
    const aiTags = rawAiTags || "1girl, full body, standing, white background, fashion photography, real clothing, everyday wear";

    // 画师串放最后，AI生成的tag已经包含构图词
    const finalTag = [aiTags, artistTags].filter(Boolean).join(", ");
    return { tag: finalTag, negative: negTags };
  };

  const handleGenerate = async (overrideTag = null) => {
    if (!selectedScheme) return;
    setGenerating(true); setGenProgress(overrideTag?"使用自定义prompt…":"文字AI组装prompt…"); setResultImg(null);
    setShowPromptEdit(false);

    // mock模式：无token时用占位渐变色块验证流程
    if (!settings.naiToken) {
      await new Promise(r => setTimeout(r, 800));
      setGenProgress("（测试模式）生成占位图…");
      await new Promise(r => setTimeout(r, 600));
      const c = selectedColor.hex;
      const mockDataUrl = await new Promise(res => {
        const canvas = document.createElement("canvas");
        canvas.width = 416; canvas.height = 608;
        const ctx = canvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, 416, 608);
        grad.addColorStop(0, c + "cc");
        grad.addColorStop(1, c + "44");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 416, 608);
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(80, 120, 256, 360);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.font = "14px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("NAI 测试占位图", 208, 300);
        ctx.fillText(selectedScheme.name, 208, 320);
        res(canvas.toDataURL("image/png"));
      });
      const mockTag = `[mock] ${selectedScheme.name}, ${selectedColor.hex}`;
      const mockItem = { dataUrl: mockDataUrl, prompt: mockTag, negative: "",
        schemeId: selectedScheme.id, schemeName: selectedScheme.name,
        color: selectedColor.hex, id: Date.now() };
      setResultImg(mockItem);
      onSaveToWardrobe(mockItem); // 自动存入
      setChatMessages([]);
      setStep("result");
      setGenerating(false);
      return;
    }

    try {
      // 1. 生成prompt（或使用用户编辑的）
      let tag, negative;
      if (overrideTag) {
        tag = overrideTag;
        negative = settings.negative || "";
      } else {
        ({ tag, negative } = await buildPromptViaAI(selectedScheme, selectedColor.hsl));
      }
      setGenProgress("发送至NAI生成中…");

      // 2. 调NAI中转（SSE流式）
      const size = settings.naiSize || "竖图";
      const proxyUrl = (settings.naiProxyUrl || "https://std.loliyc.com/api/generate").trim();
      const reqBody = {
        token: settings.naiToken,
        model: settings.naiModel || "nai-diffusion-4-5-full",
        sampler: settings.naiSampler || "k_dpmpp_2m",
        noise_schedule: settings.naiNoiseSchedule || "karras",
        cfg: settings.naiCfg || "0",
        scale: settings.naiScale || "5",
        steps: settings.naiSteps || "28",
        seed: -1, size, stream: 1, nocache: 1,
        tag, negative,
        addition: { imageToImageBase64:null, vibeTransferList:[], multiRoleList:[], characterKeep:null },
      };

      // 中转站URL里如果imageUrl相对路径，需要取base
      const proxyBase = proxyUrl.replace(/\/api\/generate.*$/, "").replace(/\/api$/, "");

      const resp = await fetch(proxyUrl, {
        method:"POST",
        headers:{ "Authorization":`Bearer ${settings.naiToken}`, "Content-Type":"application/json" },
        body:JSON.stringify(reqBody),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // 读取流式NDJSON
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
            if (obj.status === "success" && obj.url) {
              imageUrl = obj.url.startsWith("http") ? obj.url : proxyBase + obj.url;
            }
          } catch {}
        }
      }

      if (!imageUrl) throw new Error("未收到图片URL");
      setGenProgress("下载图片…");

      // 下载图片转dataUrl
      const imgResp = await fetch(imageUrl);
      const blob = await imgResp.blob();
      const dataUrl = await new Promise(res => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob);
      });

      const newItem = { dataUrl, prompt:tag, negative, schemeId:selectedScheme.id,
        schemeName:selectedScheme.name, color:selectedColor.hex, id:Date.now() };
      setResultImg(newItem);
      onSaveToWardrobe(newItem); // 自动存入
      setChatMessages([]);
      setStep("result");

    } catch (err) {
      console.error("生成失败:", err);
      setGenProgress(`生成失败：${err.message || String(err)}`);
      setGenerating(false);
      return;
    }
    setGenerating(false);
  };

  const handleSave = () => {
    if (!resultImg) return;
    onSaveToWardrobe(resultImg);
    setSaveFeedback(true);
    setTimeout(()=>setSaveFeedback(false), 1800);
  };

  const reset = () => {
    setStep("upload"); setUploadedImg(null); setExtractedColors([]);
    setSelectedColor(null); setSchemes([]); setSelectedScheme(null);
    setResultImg(null); setSelectedSkin(null);
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%",overflow:"hidden" }}>
      <div style={{ flex:1,overflowY:"auto",padding:"16px" }}>

        {/* ── 上传区 ── */}
        <div style={{ marginBottom:"18px" }}>
          <SectionLabel>01 · 上传衣物图片（自己的或网图）</SectionLabel>
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
              {/* 测试入口 */}
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
                          <div key={ci} style={{ width:"8px",height:"8px",borderRadius:"50%",
                            backgroundColor:c.hex }}/>
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
              {/* 已选：紧凑行展示当前图/色卡，保留上传按钮和重选 */}
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
                  backgroundColor:T.bg,fontSize:"10px",color:T.textSub,cursor:"pointer",flexShrink:0,
                }}>换图</button>
                <button onClick={reset} style={{
                  padding:"4px 8px",borderRadius:"6px",border:"none",
                  backgroundColor:"transparent",fontSize:"10px",color:T.textMuted,cursor:"pointer",flexShrink:0,
                }}>重选</button>
              </div>
              {/* 测试色卡快速切换（仍然可见） */}
              <div style={{ display:"flex",flexWrap:"wrap",gap:"5px" }}>
                {TEST_OUTFITS.map((outfit,i)=>(
                  <button key={i} onClick={()=>handleLoadTestOutfit(outfit)} style={{
                    padding:"4px 8px",borderRadius:"20px",
                    border:`1px solid ${uploadedImg.mockName===outfit.name?T.accent:T.border}`,
                    backgroundColor:uploadedImg.mockName===outfit.name?T.accentSoft:T.bg,
                    fontSize:"10px",color:T.textSub,cursor:"pointer",
                    display:"flex",alignItems:"center",gap:"4px",
                  }}>
                    <div style={{ display:"flex",gap:"2px" }}>
                      {outfit.colors.slice(0,3).map((c,ci)=>(
                        <div key={ci} style={{ width:"7px",height:"7px",borderRadius:"50%",
                          backgroundColor:c.hex }}/>
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

        {/* ── 提取主色 + 肤色 ── */}
        {step !== "upload" && (
          <div style={{ marginBottom:"18px" }}>
            <SectionLabel>02 · 选择衣物主色</SectionLabel>
            <div style={{ display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px" }}>
              {extractedColors.map((c,i)=>(
                <button key={i} onClick={()=>setSelectedColor(c)} style={{
                  width:"38px",height:"38px",borderRadius:"9px",
                  backgroundColor:c.hex,border:"none",cursor:"pointer",flexShrink:0,
                  outline:selectedColor===c?`3px solid ${T.accent}`:"3px solid transparent",
                  outlineOffset:"2px",transition:"outline 0.15s",
                  boxShadow:T.shadow,
                }}/>
              ))}
              <button onClick={()=>setStep("upload")} style={{
                width:"38px",height:"38px",borderRadius:"9px",
                border:`1px dashed ${T.border}`,backgroundColor:"transparent",
                color:T.textMuted,fontSize:"18px",cursor:"pointer",
              }}>+</button>
            </div>
            {selectedColor && (
              <div style={{ display:"flex",alignItems:"center",gap:"10px",
                backgroundColor:T.surface,borderRadius:T.radiusSm,
                padding:"8px 12px",border:`1px solid ${T.border}` }}>
                <div style={{ width:"28px",height:"28px",borderRadius:"6px",
                  backgroundColor:selectedColor.hex,border:"1px solid rgba(0,0,0,0.1)" }}/>
                <span style={{ fontSize:"11px",color:T.textSub,fontFamily:"monospace" }}>
                  {selectedColor.hex.toUpperCase()} · H{selectedColor.hsl.h}° S{selectedColor.hsl.s}% L{selectedColor.hsl.l}%
                </span>
              </div>
            )}

            <div style={{ marginTop:"14px" }}>
              <SectionLabel>肤色（配色参照）</SectionLabel>
              <div style={{ display:"flex",gap:"6px",flexWrap:"wrap" }}>
                {SKIN_TONES.map(skin=>(
                  <button key={skin.id} onClick={()=>setSelectedSkin(skin)} style={{
                    display:"flex",flexDirection:"column",alignItems:"center",gap:"4px",
                    padding:"6px 8px",borderRadius:"9px",border:"none",cursor:"pointer",
                    backgroundColor:selectedSkin?.id===skin.id?T.surface:"transparent",
                    outline:selectedSkin?.id===skin.id?`2px solid ${T.accent}`:"2px solid transparent",
                    outlineOffset:"1px",
                  }}>
                    <div style={{ width:"30px",height:"30px",borderRadius:"50%",
                      backgroundColor:skin.hex,border:"1px solid rgba(0,0,0,0.1)",
                      boxShadow:T.shadow }}/>
                    <span style={{ fontSize:"9px",color:T.textSub }}>{skin.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleAnalyze} disabled={!selectedColor||!selectedSkin}
              style={{ width:"100%",marginTop:"12px",padding:"10px",borderRadius:T.radiusSm,
                border:"none",backgroundColor:(!selectedColor||!selectedSkin)?T.border:T.accent,
                color:(!selectedColor||!selectedSkin)?T.textMuted:"#fff",
                fontSize:"12px",fontWeight:"500",cursor:(!selectedColor||!selectedSkin)?"not-allowed":"pointer" }}>
              分析配色方案
            </button>
          </div>
        )}

        {/* ── 配色方案 ── */}
        {(step==="scheme"||step==="result") && schemes.length>0 && (
          <div style={{ marginBottom:"18px" }}>
            <SectionLabel>03 · 选择配色方案</SectionLabel>
            {schemes.map((s,i)=>(
              <div key={s.id} onClick={()=>setSelectedScheme(s)}
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

            {/* 生图按钮 */}
            <button onClick={()=>handleGenerate()} disabled={generating||!selectedScheme}
              style={{ width:"100%",padding:"11px",borderRadius:T.radiusSm,border:"none",
                backgroundColor:generating?T.border:T.accent,
                color:generating?T.textMuted:"#fff",
                fontSize:"12px",fontWeight:"500",cursor:generating?"default":"pointer",
                marginTop:"4px" }}>
              {generating ? genProgress||"生成中…"
                : settings.naiToken ? "生成穿搭" : "生成穿搭（测试模式）"}
            </button>
            {!settings.naiToken && !generating && (
              <p style={{ fontSize:"10px",color:T.textMuted,margin:"4px 0 0",textAlign:"center" }}>
                未填NAI Token，将生成占位色块用于流程测试
              </p>
            )}
          </div>
        )}

        {/* ── 生图结果 ── */}
        {step==="result" && resultImg && (
          <div style={{ marginBottom:"18px" }} ref={resultRef}>
            <SectionLabel>04 · 生成结果</SectionLabel>
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
            {/* prompt查看/编辑 */}
            {showPromptEdit ? (
              <div style={{ marginBottom:"10px" }}>
                <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 4px" }}>NAI Prompt（可编辑后重新生成）</p>
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
    // 简化：逐张下载（完整版可用JSZip打包）
    for (const item of genPool) {
      if (!item.dataUrl) continue;
      const a = document.createElement("a");
      a.href = item.dataUrl; a.download = `nai_${item.id}.png`; a.click();
      await new Promise(r=>setTimeout(r,300));
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
        <SettingsField form={form} setForm={setForm} label="中转站 URL" fkey="naiProxyUrl" placeholder="https://std.loliyc.com/api/generate"/>
        {/* Token字段：密码模式+眼睛切换 */}
        <div style={{ marginBottom:"14px" }}>
          <p style={{ fontSize:"10px",color:T.textMuted,margin:"0 0 5px",letterSpacing:"0.05em" }}>Token（STD-xxxxxx）</p>
          <div style={{ position:"relative" }}>
            <input type={showToken?"text":"password"} value={form.naiToken||""}
              onChange={e=>setForm(p=>({...p,naiToken:e.target.value}))}
              placeholder="STD-xxxxxxxx"
              style={{ width:"100%",padding:"9px 38px 9px 11px",borderRadius:T.radiusSm,
                border:`1px solid ${T.border}`,backgroundColor:T.bg,
                fontSize:"11px",color:T.text,outline:"none",boxSizing:"border-box" }}/>
            <button onClick={()=>setShowToken(v=>!v)} style={{
              position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)",
              background:"none",border:"none",cursor:"pointer",padding:"2px",
              color:T.textMuted,fontSize:"14px",lineHeight:1,
            }}>{showToken?"🙈":"👁"}</button>
          </div>
        </div>
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
            <SettingsField form={form} setForm={setForm} label="API Key" fkey="llmApiKey" placeholder="sk-xxxxxxx 或第三方key" type="password"/>
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
        <SettingsField form={form} setForm={setForm} label="审美偏好描述（辅助prompt生成）" fkey="aestheticDesc"
          placeholder="如：日系街拍、宽松廓形、低饱和莫兰迪色系…" multiline/>
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
  naiToken:"", naiProxyUrl:"https://std.loliyc.com/api/generate",
  naiModel:"nai-diffusion-4-5-full", naiSize:"竖图",
  naiSampler:"k_dpmpp_2m", naiNoiseSchedule:"karras",
  naiScale:"5", naiSteps:"28", naiCfg:"0",
  negative:"lowres, worst quality, bad anatomy, text, watermark, signature",
  artistPresets:[], activePreset:null,
  llmMode:"anthropic", llmBaseUrl:"", llmApiKey:"", llmModel:"claude-sonnet-4-6",
  aestheticDesc:"", charCard:"", memory:"",
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
function loadPool() {
  try {
    const s = localStorage.getItem(POOL_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
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
  try {
    const slim = pool.map(({dataUrl, ...rest}) => rest);
    localStorage.setItem(POOL_KEY, JSON.stringify(slim));
    // dataUrl单独存，异步压缩后存
    pool.slice(0, 20).forEach(item => {
      if (item.dataUrl) {
        compressImage(item.dataUrl).then(compressed => {
          try { localStorage.setItem(`pool_img_${item.id}`, compressed); } catch(e) {
            // 仍然太大就不存缩略图
            console.warn("图片存储失败:", e.message);
          }
        });
      }
    });
  } catch(e) { console.warn("savePool失败:", e); }
}
function loadPoolWithImages() {
  const pool = loadPool();
  return pool.map(item => ({
    ...item,
    dataUrl: (() => { try { return localStorage.getItem(`pool_img_${item.id}`) || null; } catch { return null; } })(),
  }));
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
  const [genPool, setGenPool] = useState(loadPoolWithImages);
  const [settings, setSettings] = useState(loadSettings);

  // ── 搭配页state提升，tab切换不丢失 ──
  const [chatMessages, setChatMessages] = useState([]); // 对话历史跨tab保留
  const [materials, setMaterials] = useState(loadMaterials); // 材料区，持久化
  const [genStep, setGenStep] = useState("upload");
  const [genUploadedImg, setGenUploadedImg] = useState(null);
  const [genExtractedColors, setGenExtractedColors] = useState([]);
  const [genSelectedColor, setGenSelectedColor] = useState(null);
  const [genSelectedSkin, setGenSelectedSkin] = useState(null);
  const [genSchemes, setGenSchemes] = useState([]);
  const [genSelectedScheme, setGenSelectedScheme] = useState(null);
  const [genGenerating, setGenGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState("");
  const [genResultImg, setGenResultImg] = useState(null);

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

      {/* Header */}
      <div style={{ padding:"13px 16px 10px",borderBottom:`1px solid ${T.border}`,
        backgroundColor:T.surface,flexShrink:0 }}>
        <h1 style={{ fontSize:"14px",fontWeight:"600",color:T.text,margin:0 }}>穿搭配色</h1>
      </div>

      {/* 内容：用display:none切换，保持组件不卸载，state不丢 */}
      <div style={{ flex:1,overflow:"hidden",display:"flex",flexDirection:"column" }}>
        <div style={{ display:tab==="generate"?"flex":"none", flexDirection:"column", flex:1, overflow:"hidden" }}>
          <GeneratePage
            settings={settings} onSaveToWardrobe={handleSaveToWardrobe} onUpdateMemory={handleUpdateMemory}
            onAddMaterial={handleAddMaterial}
            chatMessages={chatMessages} setChatMessages={setChatMessages}
            step={genStep} setStep={setGenStep}
            uploadedImg={genUploadedImg} setUploadedImg={setGenUploadedImg}
            extractedColors={genExtractedColors} setExtractedColors={setGenExtractedColors}
            selectedColor={genSelectedColor} setSelectedColor={setGenSelectedColor}
            selectedSkin={genSelectedSkin} setSelectedSkin={setGenSelectedSkin}
            schemes={genSchemes} setSchemes={setGenSchemes}
            selectedScheme={genSelectedScheme} setSelectedScheme={setGenSelectedScheme}
            generating={genGenerating} setGenerating={setGenGenerating}
            genProgress={genProgress} setGenProgress={setGenProgress}
            resultImg={genResultImg} setResultImg={setGenResultImg}
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
