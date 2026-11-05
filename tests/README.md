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
node tests/settings-free-models.cjs
node --test exchange-rates.test.cjs
node tests/cross-currency-ui.cjs
node tests/recognition-retry-ui.cjs
```

若 Playwright 或 Chromium 不在預設路徑，可用環境變數指定：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/usr/bin/chromium \
TEST_OUTPUT_DIR=/tmp/bill-tutorial-qa \
node tests/tutorial-ui.cjs
```

`BASE_URL` 預設為 `http://127.0.0.1:4178/`。瀏覽器測試只允許 localhost／127.0.0.1；測試不需要 API 鎖匙。UI 測試建立本身的草稿及 IndexedDB 圖片／附件樣本，並比較教學前後原有 DOM、表單、localStorage、IndexedDB、捲動位置和焦點。
跨貨幣 UI 測試會唯讀查詢 Frankfurter 取得實際匯率；它不傳送帳單或個人資料。匯率失敗情境則由測試攔截並模擬。
`recognition-retry-ui.cjs` 只在本機攔截並模擬 OCR，於 390px 驗證選單、成功後提示、加入多張新相片、重用整批相片而不重開選擇器、成功替換及失敗保留舊結果；亦驗證綠色收據按鈕直接分享圖片。朋友埋單頁初始只顯示成員提示和六人下拉；選中後才顯示該人的應付金額和項目，並載入本機單據相片供放大。測試用收據圖是合成樣本，不代表任何真實賬單。完成時會產生 `artifacts/recognition-retry-preview.png`、`artifacts/detailed-view-before-select.png` 和 `artifacts/detailed-view-preview.png`。

## 覆蓋範圍

- 新瀏覽器首次開啟只出現一次教學引導；用家可略過，重新載入後不會重複出現；往後可自行從「教學」重開。
- 教學中心只有兩個目錄，影片教學排第一、16 步互動教學排第二；影片次序為 OpenRouter API Key 設定、分帳操作示範。
- 16 步互動教學開始前提示相片辨識需 OpenRouter API Key；已有金鑰可略過，影片連結會跳至現有 Key 教學，提示留在 16 步之外。
- 兩支影片都有原生播放控制、使用 `preload="none"`，不帶 `autoplay`，初始維持暫停。
- 設定頁不再提供付費模型選項；模型清單只列免費模型，舊版 localStorage／sessionStorage 的付費選擇會自動遷回免費模型。
- 沒有已儲存 API Key 時「取得免費金鑰」為紅色，有金鑰時為綠色；設定頁的「影片教學」捷徑會打開教學中心並捲到 OpenRouter API Key 影片。
- 已設定免費模型時狀態卡只顯示模型狀態；未設定金鑰時仍保留紅色設定提醒。
- 香港繁體中文及英文介面；320×640、390×844、768×1024、1280×800 及 844×390 五種視窗。
- 16 個互動停留點：`upload`、`manual`、`verify`、`items`、`fee`、`share`、`share-options`、`replies`、`payer`、`currency`、`payment`、`tax-method`、`calculate`、`report`、`report-share`、`detail`；並核對其對應的四個 App 步驟。
- 目標高亮、卡片不遮擋目標、無橫向溢出、卡片不超過 340px、非模態對話框及示範 App 保持可互動；目前目標以外的控制不可鍵盤操作。
- 點擊影相／上載示範目標、核對後進入編輯、手動輸入捷徑、開啟認帳分享選項及模擬送出回覆。
- 實際修改示範單價及附加費，按 2:1 認帳比例計算 Cathy 的分帳；另核對按比例及平均分攤的結果。
- 報告分享／複製按鈕只顯示教學提示，不呼叫系統分享或剪貼簿；亦不開相機、檔案選擇器、寫入示範資料，或請求 OpenRouter／ntfy。
- 從原本 App 第 1–4 步進入、關閉、按 Escape、完成及重新開始後，逐項核對原有 DOM、輸入、localStorage、IndexedDB 圖片與附件、捲動位置及焦點。
- 安全測試確認新 Service Worker 不再預快取舊七步截圖頁，並在離線狀態走完 16 個互動停留點。

Chromium 自動測試不代表已在真實 iPhone Safari／Android WebView 或軟鍵盤上驗收。

既有核心測試可另外執行：

```sh
node --test ocr-cascade.test.cjs claim-relay.test.cjs
```

注意：既有 `claim-relay.test.cjs` 包含一項會使用公開 ntfy.sh 的實際網絡整合測試。

## 跨貨幣結算

`exchange-rates.test.cjs` 驗證同幣總額、實際取得的 JPY→HKD 匯率、目標貨幣的小數位四捨五入，以及查詢失敗或幣種配對錯誤時拒絕計算。`tests/cross-currency-ui.cjs` 以本機 Chromium 驗證使用者可見的來源幣／結算幣、實際換算報告，以及匯率服務失敗時不會產生報告。

匯率來自 [Frankfurter 官方 API](https://frankfurter.dev/)，使用 `/v2/rate/{base}/{quote}` 並在報告列出服務回傳的日期。這是有日期的參考匯率，與銀行、信用卡或商戶實際成交匯率可能不同。


## 分享前卡號遮蓋

```sh
node --test card-redaction.test.cjs
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/usr/bin/chromium \
BASE_URL=http://127.0.0.1:4178/ \
node tests/card-redaction-ui.cjs
```

UI 測試只對 localhost 執行，使用合成收據和假測試號碼，並 mock 本機 OCR／系統分享；它會在 320×800 和 390×844 擷取預覽、確認原圖逐 byte 不變、只分享遮蓋 JPEG 副本、手動補框／撤銷有效，以及 OCR 失敗時禁止分享。它不代表已在真實手機瀏覽器驗收。
