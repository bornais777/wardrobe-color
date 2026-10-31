import { useState } from "react";
import { saveSettings } from "../lib/storage.js";
import { Icon, Seg } from "../components/ui.jsx";

const NAI_KEYS = ["naiProxyUrl","naiToken","naiModel","naiSampler","naiNoiseSchedule","naiSteps","naiScale","naiCfg","naiSize"];
const GPT_KEYS = ["gptBaseUrl","gptApiKey","gptModel","gptSize"];
const LLM_KEYS = ["llmMode","llmBaseUrl","llmApiKey","llmModel","llmTemperature","llmMaxTokens","llmStream"];

function Panel({ title, children }) {
  return <section className="panel"><h3>{title}</h3>{children}</section>;
}

// 放在组件外，避免每次渲染重建导致输入框失焦
function Field({ label, fkey, placeholder, multiline, type, form, setForm, mono }) {
  const set = (e) => setForm((p) => ({ ...p, [fkey]: e.target.value }));
  return (
    <div className="field">
      <label>{label}</label>
      {multiline
        ? <textarea className="textarea" rows={3} value={form[fkey] || ""} onChange={set} placeholder={placeholder} />
        : <input className={`input${mono ? " mono" : ""}`} type={type || "text"} value={form[fkey] || ""} onChange={set} placeholder={placeholder} />}
    </div>
  );
}

function Secret({ label, fkey, placeholder, form, setForm }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="secret">
        <input className="input mono" type={show ? "text" : "password"} value={form[fkey] || ""} autoComplete="off"
          onChange={(e) => setForm((p) => ({ ...p, [fkey]: e.target.value }))} placeholder={placeholder} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "隐藏" : "显示"}>
          <Icon name={show ? "eyeoff" : "eye"} size={18} />
        </button>
      </div>
    </div>
  );
}

// 接口预设：把一组接口配置存成命名预设，一键切换。列表里只显示名称，不显示地址/密钥。
function ConfigPresets({ presetsKey, keys, form, setForm, commit }) {
  const [name, setName] = useState("");
  const list = form[presetsKey] || [];
  const isActive = (p) => keys.every((k) => String(form[k] ?? "") === String(p.data[k] ?? ""));
  const savePreset = () => {
    const nm = name.trim(); if (!nm) return;
    const data = {}; keys.forEach((k) => { data[k] = form[k] ?? ""; });
    const exists = list.some((p) => p.name === nm);
    const next = exists
      ? list.map((p) => (p.name === nm ? { ...p, data } : p))
      : [...list, { id: Date.now().toString(), name: nm, data }];
    commit({ ...form, [presetsKey]: next });
    setName("");
  };
  return (
    <div className="presets">
      <p className="field-label">接口预设</p>
      {list.length > 0 && (
        <div className="wrap-row" style={{ marginBottom: 10 }}>
          {list.map((p) => (
            <div key={p.id} className={`preset-pill${isActive(p) ? " on" : ""}`}>
              <button type="button" onClick={() => commit({ ...form, ...p.data })}>{p.name}</button>
              <button type="button" aria-label={`删除预设 ${p.name}`}
                onClick={() => commit({ ...form, [presetsKey]: list.filter((x) => x.id !== p.id) })}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="给当前配置起个名字" />
        <button className="btn btn-line" onClick={savePreset} disabled={!name.trim()}>保存为预设</button>
      </div>
    </div>
  );
}

export default function SettingsPage({ settings, setSettings }) {
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
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



  const sel = (fkey, dflt, opts) => (
    <select className="select" value={form[fkey] || dflt} onChange={(e) => setForm((p) => ({ ...p, [fkey]: e.target.value }))}>
      {opts.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
  const num = (label, fkey, dflt, extra = {}) => (
    <div className="field">
      <label>{label}</label>
      <input className="input" type="number" value={form[fkey] ?? dflt} {...extra}
        onChange={(e) => setForm((p) => ({ ...p, [fkey]: e.target.value }))} />
    </div>
  );
  const isOpenai = form.llmMode === "openai";

  return (
    <div className="page-scroll">
      <div className="wrap">
        <header className="page-head"><h1>设置</h1></header>

        <div className="settings-cols">
          <Panel title="NAI 生图">
            <ConfigPresets presetsKey="naiPresets" keys={NAI_KEYS} form={form} setForm={setForm} commit={commit} />
            <Field form={form} setForm={setForm} label="接口地址 URL" fkey="naiProxyUrl" placeholder="https://…/api/generate" mono />
            <Secret form={form} setForm={setForm} label="Token" fkey="naiToken" placeholder="粘贴 Token" />
            <Field form={form} setForm={setForm} label="模型" fkey="naiModel" placeholder="nai-diffusion-4-5-full" mono />
            <div className="cols-2">
              <div className="field"><label>采样器</label>{sel("naiSampler", "k_dpmpp_2m", ["k_dpmpp_2m", "k_euler_ancestral", "k_euler", "k_dpmpp_sde", "k_dpmpp_2s_ancestral"])}</div>
              <div className="field"><label>Noise Schedule</label>{sel("naiNoiseSchedule", "karras", ["karras", "exponential", "polyexponential", "native"])}</div>
            </div>
            <div className="cols-3">
              {num("Steps", "naiSteps", "28")}
              {num("Scale", "naiScale", "5")}
              {num("CFG Rescale", "naiCfg", "0", { step: "0.1" })}
            </div>
            <div className="field"><label>尺寸预设</label>{sel("naiSize", "竖图", ["竖图", "横图", "方图", "768x1344(高竖图)", "896x1152"])}</div>
            <Field form={form} setForm={setForm} label="Negative Prompt" fkey="negative" multiline
              placeholder="lowres, worst quality, bad anatomy, text, watermark…" />
          </Panel>

          <Panel title="GPT 生图（第三方）">
            <ConfigPresets presetsKey="gptPresets" keys={GPT_KEYS} form={form} setForm={setForm} commit={commit} />
            <Field form={form} setForm={setForm} label="接口地址 URL" fkey="gptBaseUrl" placeholder="https://…" mono />
            <Secret form={form} setForm={setForm} label="API Key" fkey="gptApiKey" placeholder="粘贴 API Key" />
            <Field form={form} setForm={setForm} label="模型" fkey="gptModel" placeholder="gpt-image-1" mono />
            <div className="field"><label>尺寸</label>{sel("gptSize", "1024x1536", ["1024x1536", "1024x1024", "1536x1024"])}</div>
          </Panel>

          <Panel title="文字 API">
            <ConfigPresets presetsKey="llmPresets" keys={LLM_KEYS} form={form} setForm={setForm} commit={commit} />
            <div className="field">
              <label>接口类型</label>
              <Seg block label="接口类型" value={form.llmMode || "anthropic"} onChange={(v) => setForm((p) => ({ ...p, llmMode: v }))}
                options={[{ id: "anthropic", label: "Anthropic 原生" }, { id: "openai", label: "OpenAI 兼容（第三方）" }]} />
            </div>
            {isOpenai && (
              <>
                <Field form={form} setForm={setForm} label="Base URL" fkey="llmBaseUrl" placeholder="https://api.openai.com 或第三方地址" mono />
                <Secret form={form} setForm={setForm} label="API Key" fkey="llmApiKey" placeholder="粘贴 API Key" />
              </>
            )}
            <div className="field">
              <div className="row" style={{ marginBottom: 6 }}>
                <label className="grow" style={{ margin: 0 }}>模型名</label>
                {isOpenai && <button className="btn btn-line btn-s" onClick={fetchModels} disabled={fetchingModels}>{fetchingModels ? "拉取中…" : "拉取模型列表"}</button>}
                {modelFetchStatus === "ok" && <span className="hint" style={{ color: "var(--ok)" }}>已拉取 {modelList.length} 个</span>}
                {modelFetchStatus === "err" && <span className="warn">拉取失败</span>}
              </div>
              {modelList.length > 0 && isOpenai ? (
                <select className="select" value={form.llmModel || ""} onChange={(e) => setForm((p) => ({ ...p, llmModel: e.target.value }))}>
                  {modelList.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              ) : (
                <input className="input mono" value={form.llmModel || ""} onChange={(e) => setForm((p) => ({ ...p, llmModel: e.target.value }))}
                  placeholder={isOpenai ? "gpt-4o / deepseek-chat / …" : "claude-sonnet-4-6"} />
              )}
            </div>
            <div className="cols-2">
              <div className="field"><label>温度</label>
                <input className="input" type="number" step="0.1" min="0" max="2" value={form.llmTemperature ?? ""} placeholder="0.7"
                  onChange={(e) => setForm((p) => ({ ...p, llmTemperature: e.target.value }))} /></div>
              <div className="field"><label>Token 上限</label>
                <input className="input" type="number" min="1" value={form.llmMaxTokens ?? ""} placeholder="1500"
                  onChange={(e) => setForm((p) => ({ ...p, llmMaxTokens: e.target.value }))} /></div>
            </div>
            <div className="field">
              <label>流式输出</label>
              <Seg label="流式输出" value={!!form.llmStream} onChange={(v) => setForm((p) => ({ ...p, llmStream: v }))}
                options={[{ id: true, label: "开" }, { id: false, label: "关" }]} />
              <p className="hint" style={{ marginTop: 6 }}>部分第三方接口不支持流式，遇到报错请关闭。</p>
            </div>
            <Field form={form} setForm={setForm} label="审美偏好（辅助生成 prompt）" fkey="aestheticDesc" multiline
              placeholder="如：日系街拍、宽松廓形、低饱和莫兰迪色系…" />
          </Panel>

          <Panel title="画师串预设">
            <div className="stack">
              {(form.artistPresets || []).map((preset) => (
                editingPreset === preset.id ? (
                  <div key={preset.id} className="artist on">
                    <div className="stack">
                      <input className="input" value={editingPresetData?.name || ""} placeholder="预设名称"
                        onChange={(e) => setEditingPresetData((p) => ({ ...p, name: e.target.value }))} />
                      <textarea className="textarea" rows={4} value={editingPresetData?.tags || ""} placeholder="画师串 tag，逗号分隔…"
                        onChange={(e) => setEditingPresetData((p) => ({ ...p, tags: e.target.value }))} />
                      <div className="row">
                        <button className="btn btn-primary btn-s" onClick={() => {
                          setForm((p) => ({ ...p, artistPresets: p.artistPresets.map((pr) => pr.id === preset.id ? { ...pr, ...editingPresetData } : pr) }));
                          setEditingPreset(null); setEditingPresetData(null);
                        }}>保存修改</button>
                        <button className="btn btn-quiet btn-s" onClick={() => { setEditingPreset(null); setEditingPresetData(null); }}>取消</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={preset.id} className={`artist${form.activePreset === preset.id ? " on" : ""}`}
                    onClick={() => setForm((p) => ({ ...p, activePreset: preset.id }))}>
                    <div className="row">
                      <span className="grow" style={{ fontWeight: 600 }}>{preset.name}</span>
                      {form.activePreset === preset.id && <span className="hint" style={{ color: "var(--accent-strong)" }}>使用中</span>}
                      <button className="btn btn-quiet btn-s" onClick={(e) => { e.stopPropagation(); setEditingPreset(preset.id); setEditingPresetData({ name: preset.name, tags: preset.tags }); }}>编辑</button>
                      <button className="btn btn-quiet btn-icon" aria-label="删除预设" onClick={(e) => { e.stopPropagation(); deletePreset(preset.id); }}><Icon name="x" size={16} /></button>
                    </div>
                    <p className="artist-tags">{preset.tags || "（空）"}</p>
                  </div>
                )
              ))}
              {editingPreset === "new" ? (
                <div className="artist">
                  <div className="stack">
                    <input className="input" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="预设名称（如：低饱和厚涂）" />
                    <textarea className="textarea" rows={3} value={newPresetTags} onChange={(e) => setNewPresetTags(e.target.value)} placeholder="画师串 tag，逗号分隔…" />
                    <div className="row">
                      <button className="btn btn-primary btn-s" onClick={addPreset}>保存</button>
                      <button className="btn btn-quiet btn-s" onClick={() => setEditingPreset(null)}>取消</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button className="btn btn-line btn-s" style={{ alignSelf: "flex-start" }} onClick={() => setEditingPreset("new")}>
                  <Icon name="plus" size={15} /> 新增画师串预设
                </button>
              )}
            </div>
          </Panel>

          <Panel title="图片存储">
            <div className="field">
              <label>生成图保留期限</label>
              <select className="select" value={form.poolRetention || "1m"} onChange={(e) => setForm((p) => ({ ...p, poolRetention: e.target.value }))}>
                <option value="1w">保留一周</option>
                <option value="1m">保留一个月</option>
                <option value="forever">永久保留</option>
              </select>
              <p className="hint" style={{ marginTop: 6 }}>
                原图存在浏览器 IndexedDB（刷新不丢、全分辨率）。超过期限的图会在下次打开时自动清理。衣橱里可「打包下载」为 zip。
              </p>
            </div>
          </Panel>

          <Panel title="Char 角色卡与记忆">
            <Field form={form} setForm={setForm} label="角色设定（JSON 或纯文本）" fkey="charCard" multiline placeholder="粘贴角色卡内容…" />
            <Field form={form} setForm={setForm} label="偏好记忆" fkey="memory" multiline placeholder="宽松廓形 / 不喜欢高饱和红 / 倾向方案B…" />
          </Panel>
        </div>

        <div className="savebar">
          <button className="btn btn-primary btn-lg" onClick={save}>
            {saved ? <><Icon name="check" size={18} stroke={2.2} /> 已保存</> : "保存配置"}
          </button>
        </div>
      </div>
    </div>
  );
}
