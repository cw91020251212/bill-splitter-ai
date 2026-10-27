# 互動教學瀏覽器測試

程式仍然是純靜態 GitHub Pages App，無需 build。這裡的 Playwright 只用於開發驗收，不會載入到公開頁面。

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

`BASE_URL` 預設為 `http://127.0.0.1:4178/`。此測試會建立自己的瀏覽器環境及示範草稿，所以只允許 localhost／127.0.0.1，拒絕對公開網站執行。測試不需要任何 API 鎖匙。

## 覆蓋範圍

- 香港繁體中文及英文介面。
- 320、390、768、1280px 及手機橫向畫面。
- 四個主要步驟，當中第 2 步分別示範項目編輯、分享選項和朋友認帳欄。
- 自動展開原本隱藏的功能，示範報告經原本運算核心產生。
- 提示卡／高亮位置、左右溢出、完成、上一步、中途關閉、Escape 及重新開始。
- 從原本第 1–4 步進入教學後還原；逐項比較原有 DOM、輸入、localStorage、IndexedDB 圖片與附件、捲動位置及焦點。
- 教學期間不得寫入瀏覽器儲存，亦不得請求 OpenRouter 或 ntfy。

`tutorial-safety.cjs` 另會檢查空白帳單、焦點循環、四步直接跳轉、視窗改大小、阻擋程式化副作用操作及原有文字教學。離線測試會先註冊現有 Service Worker、讓依賴載入快取，再切斷網絡；它會刻意刪除教學的 runtime cache，驗證帶版本參數的腳本／樣式仍能從 precache 取得。

以上是 Chromium 自動測試，不代表已在真實 iPhone Safari／Android WebView 或軟鍵盤上驗收。

既有核心測試可另外執行：

```sh
node --test ocr-cascade.test.cjs claim-relay.test.cjs
```

注意：既有 `claim-relay.test.cjs` 包含一項會使用公開 ntfy.sh 的實際網絡整合測試。
