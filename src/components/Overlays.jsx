import { useState, useEffect, useRef } from "react";
import { callLLM, callLLMChat } from "../lib/llm.js";
import { Icon } from "./ui.jsx";

// ═══ 问 char：桌面是右侧抽屉，手机是底部半屏 ═══
export function ChatDrawer({ imageItem, onClose, settings, onUpdateMemory, messages, setMessages }) {
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

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="问 char" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          {imageItem && (
            <div className="drawer-thumb" style={{
              backgroundColor: imageItem.color || "#ccc",
              backgroundImage: imageItem.dataUrl ? `url(${imageItem.dataUrl})` : "none" }} />
          )}
          <div className="grow">
            <p style={{ fontWeight: 650 }}>问 char</p>
            <p className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {imageItem?.schemeName || "当前搭配"}
            </p>
          </div>
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="关闭"><Icon name="x" /></button>
        </div>

        <div className="chat">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role === "user" ? "u" : "a"}`}>{m.content}</div>
          ))}
          {loading && <div className="bubble a hint">思考中…</div>}
          <div ref={bottomRef} />
        </div>

        <div className="chat-foot">
          <button className="btn btn-line btn-s" onClick={summarizePrefs} disabled={loading || msgs.length < 3}>
            <Icon name="sparkle" size={15} /> 把偏好写入记忆
          </button>
          <div className="row">
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && send()}
              placeholder="说点什么…" />
            <button className="btn btn-primary" onClick={send} disabled={!input.trim() || loading}>发送</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ═══ 编辑 prompt（底部/居中面板）═══
export function PromptEditOverlay({ item, onClose, onRegenerate }) {
  const [tag, setTag] = useState(item?.prompt || "");
  return (
    <div className="scrim bottom" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Prompt" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <p className="grow" style={{ fontWeight: 650 }}>Prompt</p>
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="关闭"><Icon name="x" /></button>
        </div>
        <textarea className="textarea mono" value={tag} onChange={(e) => setTag(e.target.value)} rows={9} />
        <div className="row">
          <button className="btn btn-primary btn-grow" onClick={() => { onRegenerate(tag); onClose(); }}>
            <Icon name="refresh" size={16} /> 用这段 prompt 重新生成
          </button>
          <button className="btn btn-line" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ═══ 大图预览 ═══
export function ImagePreview({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!item) return null;
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="preview" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-quiet btn-icon preview-close" onClick={onClose} aria-label="关闭"><Icon name="x" size={26} /></button>
        {item.dataUrl ? (
          <img src={item.dataUrl} alt="" />
        ) : (
          <div style={{ width: 280, height: 400, borderRadius: 12, background: item.color || "#666",
            display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", fontSize: 12 }}>图片未加载</div>
        )}
        {item.schemeName && <p style={{ color: "rgba(255,255,255,.7)", fontSize: 12 }}>{item.schemeName}</p>}
      </div>
    </div>
  );
}

// ═══ 右键 / 长按菜单 ═══
export function ContextMenu({ item, pos, onClose, onRegenerate, onDelete, onExport, onViewPrompt, isProduct }) {
  const actions = isProduct
    ? [
        { label: "查看 / 编辑 prompt", icon: "code", action: onViewPrompt },
        { label: "回到搭配页重新生成", icon: "refresh", action: onRegenerate },
        { label: "导出图片", icon: "download", action: onExport },
        { label: "删除", icon: "trash", action: onDelete, danger: true },
      ]
    : [
        { label: "导出图片", icon: "download", action: onExport },
        { label: "删除", icon: "trash", action: onDelete, danger: true },
      ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="menu" onClick={(e) => e.stopPropagation()}
        style={{ left: Math.max(8, Math.min(pos.x, window.innerWidth - 200)), top: Math.max(8, Math.min(pos.y, window.innerHeight - 220)) }}>
        {isProduct && item.prompt && <div className="menu-prompt mono">{item.prompt}</div>}
        {actions.map((a) => (
          <button key={a.label} className={a.danger ? "danger" : ""} onClick={() => { a.action(); onClose(); }}>
            <Icon name={a.icon} size={16} /> {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
