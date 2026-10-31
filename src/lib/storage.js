export const SETTINGS_KEY = "wardrobe_settings_v1";
export const DEFAULT_SETTINGS = {
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
export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
export const POOL_KEY = "wardrobe_pool_v1";

// ═══ IndexedDB：存生成图原图（全分辨率，不压缩，刷新不丢）═══
export const IDB_NAME = "wardrobeDB", IDB_STORE = "images";
export function idbOpen() {
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
export async function idbPut(id, dataUrl, savedAt) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ id, dataUrl, savedAt });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
export async function idbGet(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(id);
    r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
  });
}
export async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
export async function idbGetAllKeys() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).getAllKeys();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
export async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// 仅读元数据（同步，给 useState 初始化用，图片随后异步补上）
export function loadPool() {
  try {
    const s = localStorage.getItem(POOL_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

// 保留期限清理：删掉超过期限的原图 + 对应元数据
export const RETENTION_MS = { "1w": 7*86400000, "1m": 30*86400000 };
export async function cleanupExpiredImages(retention) {
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
export async function hydratePoolImages(metaList) {
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
export async function compressImage(dataUrl, maxW=400, maxH=600, quality=0.75) {
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
export function savePool(pool) {
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
export function loadPoolWithImages() {
  return loadPool().map(item => ({ ...item, dataUrl: null }));
}

// 材料区存储
export const MATERIALS_KEY = "wardrobe_materials_v1";
export function saveMaterials(materials) {
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
export function loadMaterials() {
  try {
    const s = localStorage.getItem(MATERIALS_KEY);
    const list = s ? JSON.parse(s) : [];
    return list.map(item => ({
      ...item,
      dataUrl: (() => { try { return localStorage.getItem(`mat_img_${item.id}`) || null; } catch { return null; } })(),
    }));
  } catch { return []; }
}

