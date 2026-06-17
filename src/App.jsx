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
async function callLLM({ settings, system, userContent, maxTokens = 1000 }) {
  const mode = settings.llmMode || "anthropic"; // "anthropic" | "openai"
  const model = settings.llmModel || "claude-sonnet-4-6";

  if (mode === "openai") {
    // OpenAI 兼容格式（适用于第三方中转、本地模型等）
    const baseUrl = (settings.llmBaseUrl || "https://api.openai.com").replace(/\/$/, "");
    const apiKey = settings.llmApiKey || "";
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    msgs.push({ role: "user", content: userContent });
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
    // Anthropic 原生格式
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: userContent }],
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
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    msgs.push(...messages);
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

// 配色方案→NAI色彩描述
function schemeToColorTags(scheme, mainColor) {
  const hue = mainColor.h;
  const hueNames = [
    [15,"red"],[45,"orange"],[75,"yellow"],[105,"yellow-green"],
    [135,"green"],[165,"teal"],[195,"cyan"],[225,"blue"],
    [255,"blue-violet"],[285,"violet"],[315,"pink"],[345,"rose"],[360,"red"]
  ];
  const getHueName = (h) => hueNames.find(([deg]) => h <= deg)?.[1] || "neutral";
  const mainHueName = getHueName(hue);
  const satDesc = mainColor.s > 60 ? "vivid" : mainColor.s > 30 ? "muted" : "desaturated";
  const lightDesc = mainColor.l > 70 ? "light" : mainColor.l > 40 ? "medium" : "dark";
  const schemeDescs = {
    A: `${satDesc} ${mainHueName}, monochrome palette, black and white accents, achromatic coordination`,
    B: `${satDesc} ${mainHueName}, analogous color scheme, subtle tonal variation, small accent details`,
    C: `desaturated ${mainHueName}, split-complementary colors, muted contrast, sophisticated gray tones`,
    D: `${mainHueName} with near-complementary accent, controlled tension, soft contrast coordination`,
    E: `bold ${mainHueName}, high-saturation complementary colors, strong color contrast, vibrant coordination`,
  };
  return schemeDescs[scheme.id] || `${mainHueName} color coordination`;
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
function GeneratePage({ settings, onSaveToWardrobe, onUpdateMemory, chatMessages, setChatMessages,
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

  // 文字AI生成NAI prompt
  const buildPromptViaAI = async (scheme, mainColor) => {
    const colorDesc = schemeToColorTags(scheme, mainColor);
    const artistPre = settings.artistPresets?.find(p=>p.id===settings.activePreset);
    const artistTags = artistPre ? artistPre.tags : "";
    const negTags = settings.negative || "";

    // 直接用Claude API生成prompt
    const sys = `你是NovelAI穿搭图生成专家。根据配色方案生成英文tag串。
规则：
- 只输出英文tag串，逗号分隔，不要任何解释
- 必须包含：1girl, full body, fashion, outfit, white background
- 根据配色描述加入对应颜色tag（如 blue dress, white shirt等）
- 加入穿搭风格tag：如 casual, streetwear, minimalist, layering等
- 20-35个tag，不要重复`;

    const aiTags = (await callLLM({
      settings,
      system: sys,
      userContent: `配色方案：${scheme.name}\n色彩描述：${colorDesc}\n用户审美偏好：${settings.aestheticDesc||""}`,
      maxTokens: 500,
    })).trim() || "1girl, full body, fashion, white background";
    // 组合：前置画师串 + AI生成 + 后置
    const finalTag = [artistTags, aiTags].filter(Boolean).join(", ");
    return { tag: finalTag, negative: negTags };
  };

  const handleGenerate = async () => {
    if (!selectedScheme) return;
    setGenerating(true); setGenProgress("文字AI组装prompt…"); setResultImg(null);

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
      setResultImg({ dataUrl: mockDataUrl, prompt: mockTag, negative: "",
        schemeId: selectedScheme.id, schemeName: selectedScheme.name,
        color: selectedColor.hex, id: Date.now() });
      setChatMessages([]); // 新图生成，清空上次对话
      setStep("result");
      setGenerating(false);
      return;
    }

    try {
      // 1. 生成prompt
      const { tag, negative } = await buildPromptViaAI(selectedScheme, selectedColor.hsl);
      setGenProgress("发送至NAI生成中…");

      // 2. 调NAI中转（SSE流式）
      const size = settings.naiSize || "竖图";
      const reqBody = {
        token: settings.naiToken,
        model: settings.naiModel || "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        noise_schedule: "karras",
        cfg: "0", scale: "5", steps: "28",
        seed: -1, size, stream: 1, nocache: 1,
        tag, negative,
        addition: { imageToImageBase64:null, vibeTransferList:[], multiRoleList:[], characterKeep:null },
      };

      const resp = await fetch("https://std.loliyc.com/api/generate", {
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
              imageUrl = obj.url.startsWith("http") ? obj.url : "https://std.loliyc.com" + obj.url;
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

      setResultImg({ dataUrl, prompt:tag, negative, schemeId:selectedScheme.id,
        schemeName:selectedScheme.name, color:selectedColor.hex, id:Date.now() });
      setChatMessages([]); // 新图生成，清空上次对话
      setStep("result");

    } catch (err) {
      setGenProgress(`生成失败：${err.message}`);
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
            <button onClick={handleGenerate} disabled={generating||!selectedScheme}
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
              boxShadow:T.shadowMd,marginBottom:"10px" }}>
              <img src={resultImg.dataUrl} alt="生成图" style={{ width:"100%",display:"block" }}/>
            </div>
            <div style={{ display:"flex",gap:"8px" }}>
              <Btn onClick={()=>setChatOpen(true)} variant="ghost" style={{ flex:1 }}>💬 问char</Btn>
              <Btn onClick={handleSave} style={{ flex:1,
                backgroundColor:saveFeedback?"#5a8a5a":T.accent }}>
                {saveFeedback?"✓ 已存入":"存入衣橱"}
              </Btn>
              <Btn onClick={handleGenerate} variant="ghost" style={{ padding:"9px 12px" }}>↺</Btn>
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
function WardrobePage({ genPool, setGenPool, settings, onRegenerate }) {
  const [tab, setTab] = useState("material"); // material | product
  const [materials, setMaterials] = useState([]); // 上传的原图
  const [selected, setSelected] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null); // {item, x, y}
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
    if (isProduct) setGenPool(p=>p.filter(i=>!selected.has(i.id)));
    else setMaterials(p=>p.filter(i=>!selected.has(i.id)));
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
    if (isProduct) setGenPool(p=>p.filter(i=>i.id!==item.id));
    else setMaterials(p=>p.filter(i=>i.id!==item.id));
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
                onClick={()=>selected.size>0?toggleSelect(item.id):null}
                onContextMenu={e=>handleContextMenu(e,item)}
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
  const [editingPreset, setEditingPreset] = useState(null); // 编辑中的预设id
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
        <SettingsField form={form} setForm={setForm} label="中转 Token（STD-xxxxxx）" fkey="naiToken" placeholder="STD-xxxxxxxx"/>
        <SettingsField form={form} setForm={setForm} label="模型" fkey="naiModel" placeholder="nai-diffusion-4-5-full"/>
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
          <div key={preset.id} style={{ marginBottom:"8px",padding:"10px 12px",
            borderRadius:T.radiusSm,border:`1px solid ${form.activePreset===preset.id?T.accent:T.border}`,
            backgroundColor:form.activePreset===preset.id?"#fff":T.bg,
            cursor:"pointer" }}
            onClick={()=>setForm(p=>({...p,activePreset:preset.id}))}>
            <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
              <span style={{ fontSize:"11px",fontWeight:"600",color:T.text,flex:1 }}>{preset.name}</span>
              {form.activePreset===preset.id && <span style={{ fontSize:"9px",color:T.accent,
                backgroundColor:T.accentSoft,padding:"1px 6px",borderRadius:"8px" }}>启用</span>}
              <button onClick={e=>{e.stopPropagation();deletePreset(preset.id);}} style={{
                background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontSize:"14px",padding:"2px" }}>×</button>
            </div>
            <p style={{ fontSize:"10px",color:T.textMuted,margin:"4px 0 0",lineHeight:1.4,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{preset.tags||"（空）"}</p>
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
  naiToken:"", naiModel:"nai-diffusion-4-5-full", naiSize:"竖图",
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

export default function App() {
  const [tab, setTab] = useState("generate");
  const [genPool, setGenPool] = useState([]);
  const [settings, setSettings] = useState(loadSettings);

  // ── 搭配页state提升，tab切换不丢失 ──
  const [chatMessages, setChatMessages] = useState([]); // 对话历史跨tab保留
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
    setGenPool(prev=>[img,...prev]);
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
