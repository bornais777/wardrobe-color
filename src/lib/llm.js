// ═══════════════════════════════════════════════════════
// 统一 LLM 调用（支持 Anthropic 原生 + OpenAI 兼容接口）
// 可配：温度 / token 上限 / 流式输出（设置页 → 文字 AI）
// ═══════════════════════════════════════════════════════
export const numOrUndef = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));

// 逐行读取 SSE：每个 data: {...} 回调一次
export async function readSSE(resp, onEvent) {
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
export function mergeSystemIntoFirstUser(system, messages) {
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

export async function requestLLM({ settings, system, messages, maxTokens = 1000, onDelta = null }) {
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

export async function callLLM({ settings, system, userContent, maxTokens = 1000, imageBase64 = null, imageMime = "image/jpeg", onDelta = null }) {
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
export async function callLLMChat({ settings, system, messages, maxTokens = 1000 }) {
  return requestLLM({ settings, system, messages, maxTokens });
}

