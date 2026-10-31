import { useState, useRef } from "react";
import { idbGet, savePool, saveMaterials } from "../lib/storage.js";
import { Icon, Seg } from "../components/ui.jsx";
import { ContextMenu, ImagePreview, PromptEditOverlay } from "../components/Overlays.jsx";

export default function WardrobePage({ genPool, setGenPool, materials, setMaterials, settings, onRegenerate }) {
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
    <div className="page-scroll">
      <div className="wrap">
        <header className="page-head">
          <h1>衣橱</h1>
          <Seg label="分区" value={tab} onChange={(t) => { setTab(t); clearSelect(); }}
            options={[{ id: "material", label: `材料 ${materials.length}` }, { id: "product", label: `成品 ${genPool.length}` }]} />
        </header>

        <div className="toolbar">
          {!isProduct && (
            <button className="btn btn-line btn-s" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={15} /> 上传衣物
            </button>
          )}
          {selected.size > 0 ? (
            <>
              <span className="hint">已选 {selected.size} 张</span>
              <button className="btn btn-line btn-s" onClick={exportSelected}><Icon name="download" size={15} /> 导出</button>
              <button className="btn btn-danger btn-s" onClick={deleteSelected}><Icon name="trash" size={15} /> 删除</button>
              <button className="btn btn-quiet btn-s" onClick={clearSelect}>取消</button>
            </>
          ) : (
            <>
              {isProduct && genPool.length > 0 && (
                <button className="btn btn-line btn-s" onClick={packAll}><Icon name="download" size={15} /> 打包下载</button>
              )}
              {items.length > 0 && <span className="hint" style={{ marginLeft: "auto" }}>点图片左上角的圆圈可多选；右键或长按有更多操作</span>}
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleUploadMaterial} />
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <Icon name={isProduct ? "sparkle" : "hanger"} size={30} />
            <p>{isProduct ? "还没有成品。到搭配页生成第一套。" : "还没有衣物图片。上传后会出现在这里。"}</p>
          </div>
        ) : (
          <div className={`grid${selected.size > 0 ? " selecting" : ""}`}>
            {items.map((item) => (
              <div key={item.id} className={`tile${selected.has(item.id) ? " sel" : ""}`}
                onClick={() => (selected.size > 0 ? toggleSelect(item.id) : setPreviewItem(item))}
                onContextMenu={(e) => { e.preventDefault(); handleContextMenu(e, item); }}
                onTouchStart={(e) => handleLongPressStart(e, item)}
                onTouchEnd={handleLongPressEnd}
                onTouchMove={handleLongPressEnd}>
                {item.dataUrl
                  ? <img src={item.dataUrl} alt="" draggable={false} />
                  : <div className="tile-fill" style={{ background: item.color || "#ccc" }} />}
                <button className="tile-check" aria-label="选择" aria-pressed={selected.has(item.id)}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
                  <Icon name="check" size={14} stroke={2.6} />
                </button>
                {isProduct && <div className="tile-cap">{item.schemeName || "NAI"}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {promptEditItem && (
        <PromptEditOverlay item={promptEditItem} onClose={() => setPromptEditItem(null)}
          onRegenerate={(newTag) => onRegenerate({ ...promptEditItem, overrideTag: newTag })} />
      )}
      {previewItem && <ImagePreview item={previewItem} onClose={() => setPreviewItem(null)} />}
      {contextMenu && (
        <ContextMenu item={contextMenu.item} pos={{ x: contextMenu.x, y: contextMenu.y }} isProduct={isProduct}
          onClose={() => setContextMenu(null)}
          onRegenerate={() => onRegenerate(contextMenu.item)}
          onDelete={() => deleteOne(contextMenu.item)}
          onExport={() => exportOne(contextMenu.item)}
          onViewPrompt={() => setPromptEditItem(contextMenu.item)} />
      )}
    </div>
  );
}
