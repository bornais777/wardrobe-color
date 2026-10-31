import { useState, useEffect } from "react";
import {
  loadSettings, saveSettings, loadPool, loadPoolWithImages, savePool, hydratePoolImages,
  cleanupExpiredImages, loadMaterials, saveMaterials,
} from "./lib/storage.js";
import { Icon } from "./components/ui.jsx";
import GeneratePage from "./pages/Generate.jsx";
import WardrobePage from "./pages/Wardrobe.jsx";
import SettingsPage from "./pages/Settings.jsx";

const TABS = [
  { key: "generate", label: "搭配", icon: "palette" },
  { key: "wardrobe", label: "衣橱", icon: "grid" },
  { key: "settings", label: "设置", icon: "sliders" },
];

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

  // 搭配页自己保存输入与结果（页面用 display 切换，不卸载，tab 切换不丢）
  const [chatMessages, setChatMessages] = useState([]); // 对话历史跨 tab 保留
  const [materials, setMaterials] = useState(loadMaterials);

  const handleSaveToWardrobe = (img) => {
    setGenPool((prev) => {
      const next = [img, ...prev];
      savePool(next);
      return next;
    });
  };

  const handleUpdateMemory = (newMemory) => {
    setSettings((prev) => {
      const next = { ...prev, memory: newMemory };
      saveSettings(next);
      return next;
    });
  };

  const handleRegenerate = () => setTab("generate");

  const handleAddMaterial = (item) => {
    setMaterials((prev) => {
      if (prev.find((m) => m.name === item.name && m.savedAt === item.savedAt)) return prev;
      const next = [item, ...prev];
      saveMaterials(next);
      return next;
    });
  };

  const goHome = () => { setTab("generate"); setHomeSignal((n) => n + 1); };
  const title = TABS.find((t) => t.key === tab)?.label;

  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar-logo" onClick={goHome} aria-label="回到搭配首页"><Icon name="hanger" size={19} /></button>
        <span className="topbar-title">{title}</span>
      </header>

      <nav className="rail" aria-label="主导航">
        <button className="rail-logo" onClick={goHome} aria-label="回到搭配首页" title="回到搭配首页"><Icon name="hanger" size={24} /></button>
        {TABS.map((t) => (
          <button key={t.key} className={`rail-btn${tab === t.key ? " on" : ""}`}
            aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        <div className={`page${tab === "generate" ? " on" : ""}`}>
          <GeneratePage settings={settings} onSaveToWardrobe={handleSaveToWardrobe} onUpdateMemory={handleUpdateMemory}
            onAddMaterial={handleAddMaterial} chatMessages={chatMessages} setChatMessages={setChatMessages} homeSignal={homeSignal} />
        </div>
        <div className={`page${tab === "wardrobe" ? " on" : ""}`}>
          <WardrobePage genPool={genPool} setGenPool={setGenPool} materials={materials} setMaterials={setMaterials}
            settings={settings} onRegenerate={handleRegenerate} />
        </div>
        <div className={`page${tab === "settings" ? " on" : ""}`}>
          <SettingsPage settings={settings} setSettings={setSettings} />
        </div>
      </main>
    </div>
  );
}
