# 互動教學瀏覽器測試

程式仍然是純靜態 GitHub Pages App，無需 build。Playwright 只用於開發驗收，不會載入到公開頁面；測試只可對本機執行。

## 執行

先準備 Node.js、Playwright 及 Chromium。在專案根目錄啟動靜態伺服器：

```sh
python3 -m http.server 4178
```

在另一個終端執行：

```sh
node tests/tutorial-ui.cjs
node tests/tutorial-safety.cjs
```

若 Playwright 或 Chromium 不在預設路徑，可用環境變數指定：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/usr/bin/chromium \
TEST_OUTPUT_DIR=/tmp/bill-tutorial-qa \
node tests/tutorial-ui.cjs
```

`BASE_URL` 預設為 `http://127.0.0.1:4178/`。兩個測試都會拒絕公開網站，只允許 localhost／127.0.0.1；測試不需要 API 鎖匙。UI 測試建立本身的草稿及 IndexedDB 圖片／附件樣本，並比較教學前後原有 DOM、表單、localStorage、IndexedDB、捲動位置和焦點。

## 覆蓋範圍

- 教學入口先提供互動導覽／文字新手教學選擇；文字教學驗證兩張 OpenRouter 圖片載入、五個紅圈標註及返回流程。
- 香港繁體中文及英文介面；320×640、390×844、768×1024、1280×800 及 844×390 五種視窗。
- 16 個互動停留點：`upload`、`manual`、`verify`、`items`、`fee`、`share`、`share-options`、`replies`、`payer`、`currency`、`payment`、`tax-method`、`calculate`、`report`、`report-share`、`detail`；並核對其對應的四個 App 步驟。
- 目標高亮、卡片不遮擋目標、無橫向溢出、卡片不超過 340px、非模態對話框及示範 App 保持可互動；目前目標以外的控制不可鍵盤操作。
- 點擊影相／上載示範目標、核對後進入編輯、手動輸入捷徑、開啟認帳分享選項及模擬送出回覆。
- 實際修改示範單價及附加費，按 2:1 認帳比例計算 Cathy 的分帳；另核對按比例及平均分攤的結果。
- 報告分享／複製按鈕只顯示教學提示，不呼叫系統分享或剪貼簿；亦不開相機、檔案選擇器、寫入瀏覽器儲存，或請求 OpenRouter／ntfy。
- 從原本 App 第 1–4 步進入、關閉、按 Escape、完成及重新開始後，逐項核對原有 DOM、輸入、localStorage、IndexedDB 圖片與附件、捲動位置及焦點。
- 安全測試保留空白帳單及離線驗收：註冊 Service Worker、確認教學 JS/CSS 和 OpenRouter 截圖 precache，再移除 runtime cache 並離線走完 16 個停留點。

Chromium 自動測試不代表已在真實 iPhone Safari／Android WebView 或軟鍵盤上驗收。

既有核心測試可另外執行：

```sh
node --test ocr-cascade.test.cjs claim-relay.test.cjs
```

注意：既有 `claim-relay.test.cjs` 包含一項會使用公開 ntfy.sh 的實際網絡整合測試。
