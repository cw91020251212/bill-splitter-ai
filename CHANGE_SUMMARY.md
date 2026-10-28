# 修改摘要：OpenRouter API 金鑰教學

日期：2026-10-28

## 變更內容

- 在首頁「新手教學」的「AI 設定與鎖匙」段落加入繁體中文及英文說明：登入 OpenRouter、前往 API Keys、建立並立即複製金鑰，再貼回本程式設定並驗證。
- 加入 OpenRouter API Keys 頁面的真實截圖 `images/openrouter-api-keys.webp`；截圖不顯示完整 API 金鑰。介面字樣可能隨 OpenRouter 更新而改變。
- 提醒建立金鑰不代表所有模型都免費，並提醒檢查用量／消費上限及不要分享金鑰。
- Service Worker 快取版本更新為 `v77-openrouter-key-guide`，以確保已安裝的 PWA 取得新版首頁。

## 涉及檔案

`index.html`、`sw.js`、`README.md`、`images/openrouter-api-keys.webp`。

## 驗收與部署

網站為無建置步驟的靜態 GitHub Pages 專案。OCR 核心測試 6 項通過，認帳核心測試 5 項通過（其中包含 ntfy.sh 網絡整合測試），`git diff --check` 通過。瀏覽器 UI／安全測試因環境沒有安裝 Playwright 而無法啟動。部署後可在「教學」→「AI 設定與鎖匙」檢查中英文步驟、圖片與 OpenRouter 連結。舊版 PWA 若未立即更新，可重新連線並重新載入頁面。
