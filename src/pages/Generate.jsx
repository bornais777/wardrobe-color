import { useState, useEffect, useRef, useMemo } from "react";
import { PALETTE_SERIES } from "../palette.js";
import { GENDERS, SEASONS, SEASON_EN, FACE_SHAPES, buildAnalysisPrompt } from "../prompts.js";
import { callLLM } from "../lib/llm.js";
import {
  toHex, hexToRgb, extractMainColors, SKIN_TONES, TEST_OUTFITS, matchSchemes,
  makeColor, colorNameOf, cnColorName, applyAccent,
} from "../lib/color.js";
import { Icon, FaceIcon, Seg, Chip, Toggle, Sec, inkOn } from "../components/ui.jsx";
import { ChatDrawer } from "../components/Overlays.jsx";

const DEFAULT_SKIN = SKIN_TONES[1];
const BACKEND_KEY = "wardrobe_backend_v1";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default function GeneratePage({ settings, onSaveToWardrobe, onUpdateMemory, onAddMaterial, chatMessages, setChatMessages, homeSignal }) {
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
    if (homeSignal) {
      scrollRef.current?.scrollTo({ top:0, behavior:"smooth" });
      scrollRef.current?.closest(".gen")?.scrollTo({ top:0, behavior:"smooth" });
    }
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


  // ── 界面派生 ──
  const colorName = selectedColor ? (selectedColor.name || cnColorName(selectedColor.hsl)) : "";
  const series = PALETTE_SERIES[paletteIdx] || PALETTE_SERIES[0];
  const SLOT = ["上衣", "下装", "鞋", "包与配饰"];
  const FLEX = [38, 38, 12, 12];
  const previewBlocks = selectedScheme ? selectedScheme.colors.filter(c => c.size !== "lg" && !c.isRef).slice(0, 4) : [];
  const keyOk = backend === "gpt" ? !!settings.gptApiKey : !!settings.naiToken;
  const failed = !generating && genProgress.startsWith("生成失败");
  const [stageView, setStageView] = useState("image");
  useEffect(() => { if (resultImg) setStageView("image"); }, [resultImg]);
  useEffect(() => { applyAccent(selectedColor?.hex || null); }, [selectedColor]);

  const showImage = !generating && resultImg && stageView === "image";
  const segFlex = (c) => (c.size === "lg" ? 1.5 : c.size === "md" ? 1 : 0.55);

  return (
    <div className="gen">
      {/* ═══════ 左：输入 ═══════ */}
      <section className="studio">
        <div className="studio-scroll" ref={scrollRef}>
          <p className="hint" style={{ padding: "18px 0 4px" }}>每一项都可以不填，填了的会一起参与搭配分析。</p>

          <Sec title="衣物图片" hint="选填，自己的或网图">
            {!uploadedImg ? (
              <>
                <button className="drop" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={22} />
                  <span>上传衣物图片</span>
                </button>
                <div className="wrap-row" style={{ alignItems: "center" }}>
                  <span className="hint">没有图？试试：</span>
                  {TEST_OUTFITS.map((o, i) => (
                    <Chip key={i} small onClick={() => handleLoadTestOutfit(o)}>
                      <span className="chip-dots">{o.colors.slice(0, 3).map((c, ci) => <i key={ci} style={{ background: c.hex }} />)}</span>
                      {o.name}
                    </Chip>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="up-row">
                  {uploadedImg.url
                    ? <img className="up-thumb" src={uploadedImg.url} alt="" />
                    : <div className="up-thumb-dots">{extractedColors.slice(0, 4).map((c, i) => <i key={i} style={{ background: c.hex }} />)}</div>}
                  <span className="up-name">
                    {uploadedImg.url ? uploadedImg.name : uploadedImg.mockName}
                    {!uploadedImg.url && <span className="hint"> · 测试色卡</span>}
                  </span>
                  <button className="btn btn-line btn-s" onClick={() => fileRef.current?.click()}>换图</button>
                  <button className="btn btn-quiet btn-s" onClick={() => { setUploadedImg(null); setExtractedColors([]); }}>移除</button>
                </div>
                <div className="wrap-row">
                  {TEST_OUTFITS.map((o, i) => (
                    <Chip key={i} small on={uploadedImg.mockName === o.name} onClick={() => handleLoadTestOutfit(o)}>
                      <span className="chip-dots">{o.colors.slice(0, 3).map((c, ci) => <i key={ci} style={{ background: c.hex }} />)}</span>
                      {o.name}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} />
          </Sec>

          <Sec title="衣物颜色" hint="选一个主色">
            {extractedColors.length > 0 && (
              <div>
                <p className="hint" style={{ marginBottom: 8 }}>从图片提取</p>
                <div className="wrap-row">
                  {extractedColors.map((c, i) => (
                    <button key={i} className={`dot-sw${selectedColor?.hex === c.hex ? " on" : ""}`}
                      style={{ background: c.hex }} aria-label={`提取色 ${c.hex}`} onClick={() => setSelectedColor(c)} />
                  ))}
                </div>
              </div>
            )}
            <div className="series-tabs" role="tablist" aria-label="色系">
              {PALETTE_SERIES.map((s, i) => (
                <Chip key={s.name} small on={paletteIdx === i} onClick={() => setPaletteIdx(i)}>{s.name}</Chip>
              ))}
            </div>
            <div className="swatches">
              {series.colors.map(([name, hex]) => {
                const on = selectedColor?.hex === hex.toLowerCase();
                return (
                  <button key={hex} className={`sw${on ? " on" : ""}`} aria-pressed={on}
                    onClick={() => { setSelectedColor({ ...makeColor(hex), name }); setHexInput(hex); }}>
                    <span className="sw-card">
                      <span className="sw-color" style={{ background: hex }}>
                        {on && <span className="sw-check"><Icon name="check" size={11} stroke={2.6} /></span>}
                      </span>
                      <span className="sw-name">{name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="row">
              <label className={`pick-btn${selectedColor ? " filled" : ""}`} title="自定义取色"
                style={selectedColor ? { background: selectedColor.hex } : undefined}>
                {!selectedColor && <Icon name="plus" size={18} />}
                <input type="color" value={selectedColor?.hex || "#c8b090"}
                  onChange={(e) => { setSelectedColor(makeColor(e.target.value)); setHexInput(e.target.value); }} />
              </label>
              <input className="input mono" value={hexInput} onChange={(e) => pickHex(e.target.value)}
                placeholder="输入 hex，如 #C7654D" />
              {selectedColor && (
                <button className="btn btn-quiet btn-s" onClick={() => { setSelectedColor(null); setHexInput(""); }}>清除</button>
              )}
            </div>
          </Sec>

          <Sec title="肤色" hint="配色参照，不选按自然白">
            <div className="skins">
              {SKIN_TONES.map((skin) => {
                const on = selectedSkin?.id === skin.id;
                return (
                  <button key={skin.id} className={`skin${on ? " on" : ""}`} aria-pressed={on}
                    onClick={() => setSelectedSkin(on ? null : skin)}>
                    <i style={{ background: skin.hex }} />{skin.label}
                  </button>
                );
              })}
            </div>
          </Sec>

          <Sec title="单品" hint="自己填，颜色可选">
            {garments.map((g) => (
              <div key={g.id} className="garment">
                <input className="input" value={g.name} placeholder="如：夹克 / 短裙 / 玛丽珍鞋"
                  onChange={(e) => { updateGarment(g.id, { name: e.target.value }); if (e.target.value.trim()) clearToggle("garment"); }} />
                <label className={`pick-btn${g.color ? " filled" : ""}`} title="选颜色（可不选）"
                  style={g.color ? { background: g.color } : undefined}>
                  {!g.color && <Icon name="palette" size={18} />}
                  <input type="color" value={g.color || "#c8b090"} onChange={(e) => updateGarment(g.id, { color: e.target.value })} />
                </label>
                {g.color && <button className="btn btn-quiet btn-s" onClick={() => updateGarment(g.id, { color: "" })}>清色</button>}
                <button className="btn btn-quiet btn-icon" aria-label="删除这件单品" onClick={() => removeGarment(g.id)}><Icon name="x" size={16} /></button>
              </div>
            ))}
            <button className="btn btn-line btn-s" style={{ alignSelf: "flex-start" }} onClick={addGarment}>
              <Icon name="plus" size={15} /> 再加一件
            </button>
          </Sec>

          <Sec title="季节" hint="穿的是哪个季节的衣服">
            <Seg block label="季节" options={SEASONS} value={season}
              onChange={(id) => { const next = season === id ? null : id; setSeason(next); if (next) clearToggle("season"); }} />
          </Sec>

          <Sec title="身体" hint="用来给比例和量感建议">
            <Seg label="性别" options={GENDERS} value={gender} onChange={setGender} />
            <div className="cols-2">
              <div className="unit-wrap">
                <input className="input" type="number" inputMode="decimal" value={height} placeholder="身高"
                  onChange={(e) => { setHeight(e.target.value); if (Number(e.target.value) > 0) clearToggle("body"); }} />
                <span className="unit">cm</span>
              </div>
              <div className="unit-wrap">
                <input className="input" type="number" inputMode="decimal" value={weight} placeholder="体重"
                  onChange={(e) => { setWeight(e.target.value); if (Number(e.target.value) > 0) clearToggle("body"); }} />
                <span className="unit">kg</span>
              </div>
            </div>
            <p className="hint">身高管比例，体重管量感，两项都填更准。体重数值不会出现在结果里。</p>
          </Sec>

          <Sec title="脸型" hint="不确定就不选">
            <div className="faces">
              {FACE_SHAPES.map((f) => {
                const on = faceId === f.id;
                return (
                  <button key={f.id} className={`face${on ? " on" : ""}`} aria-pressed={on}
                    title={f.id === "wide" ? "宽而钝" : f.label}
                    onClick={() => { const next = on ? null : f.id; setFaceId(next); if (next) clearToggle("face"); }}>
                    <FaceIcon id={f.id} />
                    <span>{f.label.replace("（宽而钝）", "")}</span>
                  </button>
                );
              })}
            </div>
          </Sec>

          <Sec title="想要的感觉" hint="由文字 API 转成生图提示词">
            <textarea className="textarea" value={nlDesc} onChange={(e) => setNlDesc(e.target.value)} rows={3}
              placeholder="整体感觉、场合、风格…" />
          </Sec>

          <Sec title="参与分析" hint="勾选的才会生效，填过的自动勾选">
            <div className="wrap-row">
              {FIELD_KEYS.map((f) => (
                <Toggle key={f.key} on={isOn(f.key)} onClick={() => flip(f.key)}>{f.label}</Toggle>
              ))}
            </div>
            {toggleNotes.length > 0 && (
              <div>{toggleNotes.map((n, i) => <p key={i} className="hint">· {n}</p>)}</div>
            )}
            <button className="btn btn-quiet btn-s" style={{ alignSelf: "flex-start" }} onClick={reset}>全部清空</button>
          </Sec>
        </div>

        <div className="dock">
          <div className="dock-row">
            <Seg label="生图引擎" options={[{ id: "nai", label: "NAI" }, { id: "gpt", label: "GPT" }]} value={backend} onChange={setBackend} />
            <button className="btn btn-primary btn-lg btn-grow" onClick={() => handleGenerate()} disabled={generating || !canGenerate}>
              <span className="ell">{generating ? (genProgress || "生成中…") : keyOk ? "生成穿搭" : "生成预览（测试模式）"}</span>
            </button>
          </div>
          {failed && <p className="dock-note err">{genProgress}</p>}
          {!generating && !failed && !canGenerate && <p className="dock-note">至少填一项：颜色、单品、季节、身体、脸型或感觉</p>}
          {!generating && !failed && canGenerate && !keyOk && (
            <p className="dock-note">还没填 {backend === "gpt" ? "GPT Key" : "NAI Token"}，会生成占位图用来试流程</p>
          )}
        </div>
      </section>

      {/* ═══════ 右：展示区 ═══════ */}
      <aside className="stage">
        <div className="stage-inner" ref={resultRef}>
          <div className="stage-head">
            <div className="grow">
              {selectedColor ? (
                <>
                  <h2 className="stage-title">{colorName}</h2>
                  <p className="stage-meta">
                    <span>{selectedColor.hex.toUpperCase()}</span>
                    <span>H{selectedColor.hsl.h}° S{selectedColor.hsl.s}% L{selectedColor.hsl.l}%</span>
                    {selectedSkin && <span>肤色 {selectedSkin.label}</span>}
                  </p>
                </>
              ) : (
                <h2 className="stage-title empty">先选一个衣物颜色</h2>
              )}
            </div>
            {resultImg && !generating && (
              <Seg label="展示内容" options={[{ id: "image", label: "成品" }, { id: "blocks", label: "配色" }]}
                value={stageView} onChange={setStageView} />
            )}
          </div>

          <div className="canvas">
            {showImage ? (
              <img src={resultImg.dataUrl} alt="生成的穿搭图" />
            ) : previewBlocks.length > 0 ? (
              <div className="blocks">
                {previewBlocks.map((c, i) => (
                  <div key={i} className="block" style={{ "--f": FLEX[i], background: c.hex, color: inkOn(c.hex) }}>
                    <b>{SLOT[i]}</b><span>{c.hex.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="canvas-empty"><p>选好颜色后，这里先预览整套配色，<br />点「生成穿搭」再出图。</p></div>
            )}
            {generating && (
              <div className="busy" role="status">
                <div className="spin" />
                <p>{genProgress || "生成中…"}</p>
              </div>
            )}
          </div>

          {resultImg && !generating && (
            <>
              <div className="stage-actions">
                <button className="btn btn-line" onClick={() => setChatOpen(true)}><Icon name="chat" size={16} /> 问 char</button>
                <button className="btn btn-line" onClick={() => handleGenerate()}><Icon name="refresh" size={16} /> 再生成一张</button>
                <button className="btn btn-quiet" onClick={() => { setEditingPrompt(resultImg.prompt || ""); setShowPromptEdit((v) => !v); }}>
                  <Icon name="code" size={16} /> Prompt
                </button>
                <span className="saved"><Icon name="check" size={14} stroke={2.2} /> 已存入衣橱</span>
              </div>
              {showPromptEdit && (
                <div className="prompt-box">
                  <textarea className="textarea mono" rows={6} value={editingPrompt} onChange={(e) => setEditingPrompt(e.target.value)} />
                  <div className="row">
                    <button className="btn btn-primary btn-s" onClick={() => handleGenerate(editingPrompt)}>用这段 prompt 重新生成</button>
                    <button className="btn btn-quiet btn-s" onClick={() => setShowPromptEdit(false)}>收起</button>
                  </div>
                </div>
              )}
            </>
          )}

          {schemes.length > 0 && (
            <div>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <h3 className="block-title">配色方案</h3>
                <span className="hint">选一种用来生成</span>
              </div>
              <div className="schemes">
                {schemes.map((s) => {
                  const on = selectedScheme?.id === s.id;
                  const [sid, sname] = s.name.split(" · ");
                  return (
                    <button key={s.id} className={`scheme${on ? " on" : ""}`} aria-pressed={on} onClick={() => setSchemeId(s.id)}>
                      <div className="scheme-top"><span className="scheme-id">{sid}</span><span className="scheme-name">{sname}</span></div>
                      <div className="band">
                        {s.colors.map((c, i) => <i key={i} title={c.label} style={{ "--f": segFlex(c), background: c.hex }} />)}
                      </div>
                      {on && (
                        <>
                          <div className="band-labels">{s.colors.map((c, i) => <span key={i} style={{ "--f": segFlex(c) }}>{c.label}</span>)}</div>
                          <p className="scheme-desc">{s.desc}</p>
                          {s.warning && <p className="warn" style={{ marginTop: 4 }}>{s.warning}</p>}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {analysis && (
            <section className="analysis">
              <div className="analysis-head">
                <h3 className="block-title">搭配分析</h3>
                <button className="btn btn-quiet btn-s" onClick={() => setShowAnalysis((v) => !v)}>{showAnalysis ? "收起" : "展开"}</button>
              </div>
              {showAnalysis && <p className="analysis-body">{analysis}</p>}
            </section>
          )}
        </div>
      </aside>

      {chatOpen && (
        <ChatDrawer imageItem={resultImg} onClose={() => setChatOpen(false)} settings={settings}
          onUpdateMemory={onUpdateMemory} messages={chatMessages} setMessages={setChatMessages} />
      )}
    </div>
  );
}
