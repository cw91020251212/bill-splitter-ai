# 分帳管家 AI · Bill Splitter AI

用 AI 讀單據、朋友自助認領，自動計出每人應付幾錢。
純前端單頁應用，無後端、無資料庫，所有資料只留在你自己部機。

已加入 **PWA 支援**：可以「加入主畫面」當 App 用，離線都開得。

---

## 檔案結構

```
bill-splitter-ai/
├── index.html                  ← 主程式（你原本個 App，邏輯 100% 無改）
├── manifest.webmanifest        ← PWA 設定（App 名、顏色、圖示）
├── sw.js                       ← Service worker（離線快取）
├── pwa.js                      ← 安裝提示 + 更新提示
├── .nojekyll                   ← 叫 GitHub Pages 唔好用 Jekyll 處理
├── README.md
├── LICENSE
└── icons/
    ├── icon.svg                ← 向量原圖（可無限放大）
    ├── favicon.ico             ← 多尺寸 16–256px
    ├── favicon-16.png
    ├── favicon-32.png
    ├── favicon-48.png
    ├── icon-96.png
    ├── icon-192.png
    ├── icon-256.png
    ├── icon-384.png
    ├── icon-512.png
    ├── icon-1024.png           ← 備用大圖（App Store／宣傳用）
    ├── apple-touch-icon.png    ← 180px，iPhone／iPad 專用
    ├── icon-192-maskable.png   ← Android 自適應圖示
    └── icon-512-maskable.png
```

---

## 部署到 GitHub Pages

1. 開一個新 repo，例如 `bill-splitter-ai`。
2. 將**呢個資料夾裡面所有檔案**（連 `icons/` 資料夾）放入 repo 根目錄。
   ⚠️ 唔好多包一層資料夾，`index.html` 要直接在 repo 最頂層。
3. Repo → **Settings** → **Pages** → Source 揀 `Deploy from a branch`，
   branch 揀 `main`、資料夾揀 `/ (root)` → Save。
4. 等一兩分鐘，網址就會係：

   ```
   https://cw91020251212.github.io/bill-splitter-ai/
   ```

### 幾個重點

- **一定要 HTTPS。** GitHub Pages 本身就係 HTTPS，所以 PWA 安裝同離線功能開箱即用。
  用 `file://` 直接雙擊開個 HTML 係**唔會**有安裝功能的（瀏覽器規定）。
- 所有路徑都係**相對路徑**，所以 repo 叫咩名都照 work，改名都唔需要改 code。
- `.nojekyll` 要保留，否則 GitHub 可能會無視某些檔案。

---

## 手機安裝方法

**Android（Chrome／Edge／Samsung Internet）**
開網址 → 底部會彈出「📲 安裝分帳管家」→ 按「安裝」。
或者右上 ⋮ → 「安裝應用程式」／「加到主畫面」。

**iPhone／iPad（Safari）**
開網址 → 按底部**分享**圖示 ⬆️ → 揀「**加入主畫面**」→ 加入。
（iOS 唔支援自動安裝提示，所以 App 會提你一次手動步驟。）

**電腦（Chrome／Edge）**
網址欄右邊會出現一個安裝圖示 ⊕，按落去就得。

裝完之後會有獨立圖示、開起嚟無瀏覽器網址欄，同一般 App 一樣。

---

## 離線可以做咩？

| 功能 | 離線 |
|---|---|
| 開 App、睇介面 | ✅ 可以 |
| 手動輸入項目、計分帳 | ✅ 可以 |
| 睇歷史紀錄、匯出 CSV | ✅ 可以 |
| 複製認領表／結果 | ✅ 可以 |
| **AI 讀單據（拍照識別）** | ❌ 需要網絡（要呼叫 AI 服務） |

App 本身偵測到離線會自動提示你改用手動輸入。

---

## 改完 index.html 之後（重要）

Service worker 會快取舊版本。你更新完 `index.html`，請同時開 `sw.js`，
將第一行的版本號加一：

```js
const CACHE_VERSION = 'v1';   // 改成 'v2'、'v3' …
```

咁舊用戶下次開就會收到「🔄 有新版本可用」提示，按「更新」即可。
唔改版本號的話，已安裝嘅用戶可能會繼續睇到舊版。

---

## 關於私隱

- 冇後端、冇伺服器，你嘅單據同金額**唔會**傳去我哋任何地方。
- 歷史紀錄存在瀏覽器 `localStorage`，只在你部機。
- 你嘅 AI API key 只存在你部機；`sw.js` 已明確設定**永不快取**
  `openrouter.ai` 同 `googleapis.com` 嘅請求。
- 上傳嘅單據圖片只會直接傳去你自己揀嘅 AI 供應商（OpenRouter／Google）。

⚠️ 提醒：如果你 fork 或公開個 repo，記住**唔好**將 API key 寫死在 code 入面。
呢個 App 設計上係要用戶自己輸入 key，key 只留在瀏覽器。

---

## Icon 設計

綠色漸變底（`#22C55E` → `#117A3A`，跟 App 主色）＋ 白色收據 ＋ 綠色勾號徽章。
16px 細尺寸會自動簡化內部線條，確保 favicon 都睇得清。
`icon.svg` 係向量版，要改色或改尺寸由佢入手最方便。

---

## License

MIT — 見 `LICENSE`。
