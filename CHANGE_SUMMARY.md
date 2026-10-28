# OpenRouter 教學顯示修正摘要

日期：2026-10-28

## 修正內容

先前的 OpenRouter 說明只放在「詳細說明」頁。按「教學」會先進入 16 步互動導覽，因此用戶在第一頁看不到該標題。這次在互動導覽每一頁新增「OpenRouter 金鑰申請教學」按鈕，點擊後直接打開詳細教學；OpenRouter 區段已移到說明頁前段並預設展開。從導覽跳轉時會回到說明頁頂部。

詳細說明包含註冊／登入、建立及複製金鑰、貼回程式設定並驗證的中英文步驟，以及真實 OpenRouter API Keys 頁面截圖和用量、安全提醒。

## 快取與驗收

快取版本為 `v79-openrouter-tour-help`。原先的瀏覽器工作階段仍引用 `v78-openrouter-tutorial-visible`，因此看不到新版入口。重新載入目前公開首頁後，實際打開「教學」已確認第一張卡顯示「OpenRouter 金鑰申請教學」按鈕；點擊後可見「OpenRouter：申請 API 金鑰」標題、申請步驟和圖片。

## 相關檔案

`index.html`、`tutorial.js`、`tutorial.css`、`sw.js`、`README.md`、`images/openrouter-api-keys.webp`。
