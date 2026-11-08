# 互動教學瀏覽器測試

程式仍然是純靜態 GitHub Pages App，無需 build。Playwright 只用於開發驗收，不會載入到公開頁面；測試只可對本機執行。

## R105 四位選填認證碼

`node tests/friend-recognition.cjs` 使用本機記憶體 Worker／DO 驗證空白碼可認帳、姓名找回、四位碼及前導零、錯碼拒絕、小型修改入口、同一連結重算及舊密碼相容。認證碼不能出現在 URL、草稿或公開結果。`PUBLIC_STATIC_QA=1 BASE_URL=https://cw91020251212.github.io/bill-splitter-ai/` 只讀正式靜態頁面，所有認帳／结果 API 仍攔截到本機，不能讀寫真實帳單。後端仍用 `node --test worker/claim-auth.test.mjs worker/worker-core.test.mjs`。

R107 另驗證四位碼在輸入到最後一位時沒有水平捲動、首位仍可見；逐字輸入、刪除、重打、失焦及重新聚焦都涵蓋初次認帳及修改畫面。

R108 在 `node tests/settings-free-models.cjs` 驗證 390px 及 320px 視窗下首頁選單維持 160px 寬、6 個項目高度至少 44px、字體至少 16px、項目相隔至少 8px，並且沒有橫向溢出。設定 `MENU_SCREENSHOT_PATH=/absolute/path.png` 可擷取手機畫面。

R109 的 `friend-recognition.cjs` 驗證新認帳連結預設 14 日，以及沒有朋友回覆時仍可前進填墊支人再返回。`friend-navigation.cjs` 驗證分享認帳／結果頁使用藍色 accent，而主辦人本機預覽仍保留綠色；其 API 全被 mock，不讀寫正式帳單。

R110 的 `friend-recognition.cjs` 驗證認帳收件箱和回覆欄只在第三步顯示、無回覆時報告按鈕停用且仍可填墊支人／貨幣、有效回覆到達後按鈕啟用並在同頁結算。教學 UI／安全測試的 replies 階段步驟映射亦已改為第三步。

R111 的 `friend-recognition.cjs` 另檢查第三步 DOM 順序：墊支人、貨幣、付款方式、附加費分攤、認帳回覆欄、產生報告按鈕。

R112 的 `friend-recognition.cjs` 驗證計算按鈕有中英動作提示、網頁分享卡先於後備文字版、超長朋友網址僅縮短顯示且 href 保持完整、簡單／詳細版預設收起並可展開。`cross-currency-ui.cjs` 會先展開後備區再測試文字版操作。

R113 的 `friend-recognition.cjs` 驗證活動名稱「確定」按鈕使用 smooth scroll 前往分享按鈕、活動名稱未建立連結前仍可修改，以及結算 CTA 主文字與提示文字均無 text-shadow/drop-shadow。

R114 的 `tutorial-ui.cjs` 驗證雙語 18 階段教學、第二步分享與第三步先設定後回覆、第四步 Web-first 及預設收合後備、示例試算、退出還原及 Step 1–4 重啟；`tutorial-safety.cjs` 驗證不觸發真實分享、剪貼簿、相機或 API。兩段示範影片均保持 R114 前原始資產。`settings-free-models.cjs` 驗證左上角只顯示 `R114`、舊 Nano 選擇遷移到 Dots3-Note、首屏與設定頁都能保存 Dots、Nemotron 及 `openrouter/free`，且不覆蓋 OpenRouter key。`recognition-retry-ui.cjs` 驗證 Dots3-Note 預設及兩個固定模型的 cascade；`ocr-cascade.test.cjs` 驗證隨機路由只在明確選取時執行，不會自動進入固定 cascade。`friend-whatsapp-details.cjs` 以不同新舊菜名重現 OCR 更新，驗證新 hash 帶入最新項目名稱，同時保留 session、加密回覆 room 和活動 metadata。

R104 下述八字强制密碼介面測試是歷史規格；R105 新介面以 `friend-recognition.cjs` 為準。姓名未設定碼時只能按姓名識別，不是强身份保護；保留舊密碼驗證、期限、主辦人權限及精確認帳比對測試。

## R104 姓名＋密碼

`node --test worker/claim-auth.test.mjs worker/worker-core.test.mjs` 使用本機假的 DO／KV 執行實際驗證程式，覆蓋姓名密碼、跨姓名 token、同名並行、舊認帳搶綁、主辦人單次確認碼、重設、限流及到期。`BASE_URL=http://127.0.0.1:4192/ node tests/friend-password.cjs` 使用實際 Worker／DO 邏輯的記憶體服務，並在手機瀏覽器驗證首次設定、密碼閘、保存及同一連結重新結算；不呼叫正式 Cloudflare 或 ntfy，不讀寫真實帳單。

R103 免密碼的 `friend-revisions.cjs` 及舊 relay 收帳 mock 不代表 R104 驗收，修改流程以 `friend-password.cjs` 為準。純數量比對仍可用 `node --test claim-revisions.test.cjs`。`friend-navigation.cjs` 保留朋友頁無主程式入口的檢查。

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

同一條認帳／結果連結的 UI 測試（390px 手機視窗）會 mock Worker 寫入和 WhatsApp，不會建立正式分享資料；Worker 的 pending→ready、主辦人 token 和期限可另以 `node --test worker/worker-core.test.mjs` 測試。先啟動 localhost 靜態伺服器，再執行：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/usr/bin/chromium \
BASE_URL=http://127.0.0.1:4178/ \
node tests/friend-whatsapp-details.cjs
node --test worker/worker-core.test.mjs
```

朋友結果頁導覽測試：`PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium BASE_URL=http://127.0.0.1:4178/ node tests/friend-navigation.cjs`。涵蓋載入、成功、失效、網絡失敗、空白分享 ID、同一連結 iframe 及本機預覽返回入口。此測試全部 Worker/ntfy 请求均被攔截，只在隔離瀏覽器建立合成預覽；也可把 `BASE_URL` 設為本專案正式 GitHub Pages 作唯讀部署驗收，不會讀取或修改任何真實帳單。`SCREENSHOT_DIR` 可指定驗收截圖輸出目錄。

修改認帳測試：`node --test claim-revisions.test.cjs` 及 `PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium BASE_URL=http://127.0.0.1:4178/ node tests/friend-revisions.cjs`。測試全部分享與認帳 API 均攔截使用合成資料，涵蓋返回修改、從結果恢復、本機保存、重新提交、舊結果等待、數量／實際單位比對、重新結算、失敗重試及到期封鎖。Relay 全部撤回與同名覆蓋以 `node --test --test-name-pattern='explicit clear|upsert keeps' claim-relay.test.cjs` 驗證，不會呼叫公開 ntfy。

若 Playwright 或 Chromium 不在預設路徑，可用環境變數指定：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/usr/bin/chromium \
TEST_OUTPUT_DIR=/tmp/bill-tutorial-qa \
node tests/tutorial-ui.cjs
```

`BASE_URL` 預設為 `http://127.0.0.1:4178/`。瀏覽器測試只允許 localhost／127.0.0.1；測試不需要 API 鎖匙。UI 測試建立本身的草稿及 IndexedDB 圖片／附件樣本，並比較教學前後原有 DOM、表單、localStorage、IndexedDB、捲動位置和焦點。
跨貨幣 UI 測試會唯讀查詢 Frankfurter 取得實際匯率；它不傳送帳單或個人資料。匯率失敗情境則由測試攔截並模擬。
`recognition-retry-ui.cjs` 只在本機攔截並模擬 OCR，使用本機 Tesseract worker stub，避免遮蓋分享流程依賴 CDN/WASM 下載；真實卡號偵測與遮蓋幾何由 `card-redaction-ui.cjs` 獨立覆蓋。於 390px 驗證選單、成功前停用重用、加入多張新相片、重用整批相片而不重開選擇器、成功替換及失敗保留舊結果；亦驗證綠色收據按鈕會先開啟本機卡號遮蓋檢視，經明確確認後才把圖片交給 mock Web Share，且不附上報告文字。朋友埋單頁初始只顯示標題、成員提示和六人下拉；選中後才顯示該人的應付金額和項目，並載入本機單據相片供放大。測試用收據圖是合成樣本，不代表任何真實賬單。完成時會產生 `artifacts/recognition-retry-preview.png`、`artifacts/detailed-view-before-select.png` 和 `artifacts/detailed-view-preview.png`。

## 覆蓋範圍

- 新瀏覽器首次開啟只出現一次教學引導；用家可略過，重新載入後不會重複出現；往後可自行從「教學」重開。
- 教學中心只有兩個目錄，影片教學排第一、18 階段互動教學排第二；影片次序為 OpenRouter API Key 設定、分帳操作示範。
- 18 階段互動教學開始前提示相片辨識需 OpenRouter API Key；已有金鑰可略過，影片連結會跳至現有 Key 教學，提示留在互動教學之外。
- 兩支影片都有原生播放控制、使用 `preload="none"`，不帶 `autoplay`，初始維持暫停；影片使用示例資料、合成香港粵語旁白和繁體中文／英文字幕，沒有真實 API Key 或分享連結。
- 設定頁不再提供付費模型選項；模型清單只列免費模型，舊版 localStorage／sessionStorage 的付費選擇會自動遷回免費模型。
- 沒有已儲存 API Key 時「取得免費金鑰」為紅色，有金鑰時為綠色；設定頁的「影片教學」捷徑會打開教學中心並捲到 OpenRouter API Key 影片。
- 已設定免費模型時狀態卡只顯示模型狀態；未設定金鑰時仍保留紅色設定提醒。
- 香港繁體中文及英文介面；320×640、390×844、768×1024、1280×800 及 844×390 五種視窗。
- 18 個互動停留點：`upload`、`manual`、`verify`、`items`、`fee`、`share`、`share-options`、`payer`、`currency`、`payment`、`tax-method`、`replies`、`calculate`、`report`、`report-web`、`report-fallback`、`report-share`、`detail`；第二步分享，第三步先填設定再核對回覆，第四步網頁版優先且後備文字預設收合。
- 目標高亮、卡片不遮擋目標、無橫向溢出、卡片不超過 340px、非模態對話框及示範 App 保持可互動；目前目標以外的控制不可鍵盤操作。
- 點擊影相／上載示範目標、核對後進入編輯、手動輸入捷徑、開啟認帳分享選項及模擬送出回覆。
- 實際修改示範單價及附加費，按 2:1 認帳比例計算 Cathy 的分帳；另核對按比例及平均分攤的結果。
- 報告分享／複製按鈕只顯示教學提示，不呼叫系統分享或剪貼簿；亦不開相機、檔案選擇器、寫入示範資料，或請求 OpenRouter／ntfy。
- 從原本 App 第 1–4 步進入、關閉、按 Escape、完成及重新開始後，逐項核對原有 DOM、輸入、localStorage、IndexedDB 圖片與附件、捲動位置及焦點。
- 安全測試確認新 Service Worker 不再預快取舊七步截圖頁，並在離線狀態走完 18 個互動停留點。

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
