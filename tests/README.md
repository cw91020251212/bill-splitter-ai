# 互動教學瀏覽器測試

程式仍然是純靜態 GitHub Pages App，無需 build。Playwright 只用於開發驗收，不會載入到公開頁面；測試只可對本機執行。

## R130 新手手機導航與 Key 引導回歸

`mobile-layout.cjs` 僅連線 localhost，驗證 320×844、390×844、320×700 首頁四種輸入入口、窄屏留白、48px 頂欄、四個可返回的命名步驟按鈕、Key 狀態與教學入口、拍照位置及 44×44px 以上觸控尺寸；另驗證 320px 大字模式無橫向溢出、第二步總額及第一件商品的位置、手動認帳緊接清單，以及 1280px 桌面版基準幾何不變。`tutorial-ui.cjs` 驗證 Key 申請入口直達教學影片，並回歸 19 個教程流程。測試不呼叫帳單或模型 API。

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/usr/bin/chromium \
BASE_URL=http://127.0.0.1:4178/ \
node tests/mobile-layout.cjs
```

## R129 同链接重算同步

`friend-recognition.cjs` 使用本机 Worker／Durable Object 验证主办人改税费并重新计算后，已打开的朋友结果页会在原 URL 自动更新总额。`worker/worker-core.test.mjs` 模拟边缘 KV 仍返回旧值，确认 GET 和 `?meta=1` 仍从 Durable Object 取得最新版本；不访问正式帐单 API。

## R127 複查回歸

`calculation-regressions.cjs` 驗證負／無效商品價與數量會在第二步顯示錯誤、舊草稿認領需要逐項核對、未提交的收據文字可在本機還原且新單確認後清除。`text-import.cjs` 覆蓋有效但有負稅／折扣／商品錯誤的 JSON 不會外送 AI。`recognition-retry-ui.cjs` 用 mock OCR 測試同名不同規格的順序變更會沿用正確認領編號；完全重複而無法唯一配對時，會改發新編號並停用舊認帳。它仍只使用 localhost／mock，不寫入正式或公開帳單 API。

## R116 四字元英數符號選填認證碼

`node tests/friend-recognition.cjs` 使用本機記憶體 Worker／DO 驗證空白碼可認帳、姓名找回、數字／大小寫英文字母／符號碼、大小寫敏感、錯碼拒絕、小型修改入口、同一連結重算及舊密碼相容。認證碼不能出現在 URL、草稿或公開結果。`PUBLIC_STATIC_QA=1 BASE_URL=https://cw91020251212.github.io/bill-splitter-ai/` 只讀正式靜態頁面，所有認帳／结果 API 仍攔截到本機，不能讀寫真實帳單。後端仍用 `node --test worker/claim-auth.test.mjs worker/worker-core.test.mjs`。

R107 另驗證四字元碼在最後一字時沒有水平捲動、首字仍可見；大小寫及符號輸入、刪除、重打、失焦及重新聚焦都涵蓋初次認帳及修改畫面。

R108 在 `node tests/settings-free-models.cjs` 驗證 390px 及 320px 視窗下首頁選單維持 160px 寬、6 個項目高度至少 44px、字體至少 16px、項目相隔至少 8px，並且沒有橫向溢出。設定 `MENU_SCREENSHOT_PATH=/absolute/path.png` 可擷取手機畫面。

R109 的 `friend-recognition.cjs` 驗證新認帳連結預設 14 日，以及沒有朋友回覆時仍可前進填墊支人再返回。`friend-navigation.cjs` 驗證分享認帳／結果頁使用藍色 accent，而主辦人本機預覽仍保留綠色；其 API 全被 mock，不讀寫正式帳單。

R115 將認帳收件箱及「朋友交返的認帳」欄移回第二步；`friend-recognition.cjs` 驗證兩個面板只在第二步出現、第三步結算設定及報告按鈕仍正常、無有效回覆時報告按鈕停用、收到回覆後仍可結算。回覆錯誤定位及結果頁「認帳」捷徑亦返回第二步。

互動教學及安全測試同步改為第二步分享後接收／核對回覆，再進入第三步填結算設定；四個步驟的工作區底色、步驟導覽色及核心色彩斷言亦納入 E2E。

R112 的 `friend-recognition.cjs` 驗證計算按鈕有中英動作提示、網頁分享卡先於後備文字版、超長朋友網址僅縮短顯示且 href 保持完整、簡單／詳細版預設收起並可展開。`cross-currency-ui.cjs` 會先展開後備區再測試文字版操作。

`friend-recognition.cjs` 驗證第二步活動名稱／期限區的按鈕顯示「下一步」，不再自動跳至分享控制；外部 AI JSON 匯入後保留在第二步頂端、先顯示原收據附圖區，按下頂端「下一步」後以慢速動畫移至底部綠色按鈕。活動名稱仍可在建立連結前修改，結算 CTA 主文字與提示文字均無 text-shadow/drop-shadow。

R114/R115 的 `tutorial-ui.cjs` 驗證雙語 18 階段教學、第二步分享及核對回覆、第三步設定後計算、第四步 Web-first 及預設收合後備、示例試算、退出還原及 Step 1–4 重啟；`tutorial-safety.cjs` 驗證不觸發真實分享、剪貼簿、相機或 API。兩段示範影片均保持 R114 前原始資產。`settings-free-models.cjs` 驗證左上角只顯示 `R114`、舊 OpenRouter 預設遷移到 PaddleOCR.js＋Dots3-Note、首頁與設定頁兩個模型選單的選項和值同步、切換方向互通、說明逐路由一致，且不覆蓋 OpenRouter key。`recognition-retry-ui.cjs` 驗證 Dots3-Note 與兩個固定模型的 cascade；`ocr-cascade.test.cjs` 驗證隨機路由只在明確選取時執行，不會自動進入固定 cascade。`friend-whatsapp-details.cjs` 以不同新舊菜名重現 OCR 更新，驗證新 hash 帶入最新項目名稱，同時保留 session、加密回覆 room 和活動 metadata。

`settings-free-models.cjs` 另以偏好 v4、已保存的 OpenRouter＋Dots 設定驗證一次性遷移到 PaddleOCR.js＋Dots3-Note；遷移後 v5 新選擇的雲端模型則會保留。`paddle-local-ocr-real-ui.cjs` 從同一 v4 設定直接啟動，不手動選 Paddle，實際驗證遷移後收據確實走本機 Paddle 推理；它亦斷言 detection／recognition 兩個模型 tar 均以 HTTP 200 從網站同源載入，且不連 Paddle 官方模型站。

`settings-free-models.cjs` 另驗證兩個選單的模型說明預設收起，按箭嘴才顯示，並隨 PaddleOCR.js 本機、Dots3-Note、Nemotron 3.5 或 OpenRouter 隨機路由選擇即時切換；內容覆蓋繁體中文和英文，符合實際圖片傳送方式、後備順序和本機首次下載約 21.5 MB 的提示。兩個選單位於互斥畫面，因此測試在切換前後比較當前值和展開文案；Playwright 官方說明 `waitForFunction` 會等 predicate 回傳 truthy 才完成（[API](https://playwright.dev/docs/api/class-page)），並建議優先使用自動重試的 locator assertion（[Assertions](https://playwright.dev/docs/test-assertions)）。

`text-import.cjs` 驗證雙語外部 AI 讀圖提示詞要求一個可下載的 `bill.json`；若對方介面不能附檔，提示詞和匯入 UI 都引導使用者複製完整回覆。測試亦覆蓋 JSON 貼上及文字檔免鎖匙匯入，JSON 不發網絡請求、普通文字只送文字給所選免費模型。合成相片經本機遮蓋後會保留在草稿；不重跑 OCR／不呼叫 AI。`friend-recognition.cjs` 再驗證結果已發布後加上相片會寫入原 Worker session，朋友仍開同一 URL 並在結果下方看到圖片；不建立第二條連結。`card-redaction-ui.cjs` 另覆蓋正常收據分享的遮蓋流程。

本次短文案回歸亦檢查收據 OCR／外部 AI 匯入、拍照／手動輸入兩組替代流程均以「或」分隔；驗證外部 AI 說明、模型摘要、草稿狀態、重試提示及同連結分享的精簡繁中。OCR 重試測試監察 `showOpenFilePicker`，確認明確新增圖片才會開啟下載選擇器，重讀不會重開。

模型說明預設收起，只顯示箭嘴；首頁與設定頁點開後顯示當前模型說明，切換模型會收起內容。外部 AI 面板使用「搵其他 AI 幫手翻譯」及「提示詞＋賬單＝專用翻譯檔（.json）」；E2E 驗證繁英文案與展開方向。

第二步導覽 E2E 亦驗證收據 OCR 與外部 AI 文字／JSON 匯入成功後停在審閱區頂部，不再自動捲到分享連結；頂部活動設定按鈕只負責以約 1.8 秒動畫移到既有綠色「下一步」，不會直接進入第三步。核對區只顯示項數／總額，恢復草稿只留短狀態；外部文字匯入後只顯示「後加圖片」按鈕與已選張數。

第四部分文案 E2E 驗證收據卡、朋友連結、狀態列、後備報告及儲存操作使用精簡繁英；簡易／詳細報告保留總額、分攤金額、匯率與付款資料，不包含冗長解釋。

`tutorial-ui.cjs` 使用授權附上的真實 Tailwind Play CDN v3.4.17 測試 fixture，而不是只有 JavaScript 全域的空 stub，因此中英多尺寸版面斷言仍會執行實際 CSS。產品頁仍使用其原本 CDN，測試 fixture 只供 E2E 使用。

`paddle-local-ocr-ui.cjs` 及 `text-import.cjs` 模擬 `showOpenFilePicker`，斷言收據圖片選擇器以 `startIn: "downloads"` 開始並提供 JPEG／PNG／WebP 類型篩選；文字匯入測試另確認 API 不可用時會回退至未限制目錄的檔案輸入，並檢查摺疊時箭頭向下、展開時向上。E2E 不會打開真實系統選檔視窗，也不使用私人收據。

R104 下述八字强制密碼介面測試是歷史規格；R105 新介面以 `friend-recognition.cjs` 為準。姓名未設定碼時只能按姓名識別，不是强身份保護；保留舊密碼驗證、期限、主辦人權限及精確認帳比對測試。

`friend-recognition.cjs` 另驗證外部 AI JSON 匯入建立的結果、遮蓋後相片寫入原 Worker session並在朋友詳情頁內嵌顯示；其後新裝置開啟同一認帳連結可見「新增一位」入口，繁中／英文切換後填新姓名和項目，主辦人返回收件匣重新接收及計算，更新結果仍使用原網址；原有朋友資料保留。API 全部路由到本機 Worker 測試 harness，零正式／公開 API 寫入。執行：`BASE_URL=http://127.0.0.1:4178/ node tests/friend-recognition.cjs`。

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
node tests/text-import.cjs
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
`recognition-retry-ui.cjs` 只在本機攔截並模擬 OCR，使用本機 Tesseract worker stub，避免遮蓋分享流程依賴 CDN/WASM 下載；真實卡號偵測與遮蓋幾何由 `card-redaction-ui.cjs` 獨立覆蓋。於 390px 驗證選單、成功前停用重用、加入多張新相片、重用整批相片而不重開選擇器、成功替換及失敗保留舊結果；亦驗證白色 44px「分享帳單」按鈕會先開啟本機卡號遮蓋檢視，經明確確認後才把圖片交給 mock Web Share，且不附上報告文字。朋友埋單頁初始只顯示標題、成員提示和六人下拉；選中後才顯示該人的應付金額和項目，並載入本機單據相片供放大。測試用收據圖是合成樣本，不代表任何真實賬單。完成時會產生 `artifacts/recognition-retry-preview.png`、`artifacts/detailed-view-before-select.png` 和 `artifacts/detailed-view-preview.png`。

## 覆蓋範圍

- 新瀏覽器首次開啟只出現一次教學引導；用家可略過，重新載入後不會重複出現；往後可自行從「教學」重開。
- 教學中心只有兩個目錄，影片教學排第一、18 階段互動教學排第二；影片次序為 OpenRouter API Key 設定、分帳操作示範。
- 18 階段互動教學開始前提示相片辨識需 OpenRouter API Key；已有金鑰可略過，影片連結會跳至現有 Key 教學，提示留在互動教學之外。
- 兩支影片都有原生播放控制、使用 `preload="none"`，不帶 `autoplay`，初始維持暫停；影片使用示例資料、合成香港粵語旁白和繁體中文／英文字幕，沒有真實 API Key 或分享連結。
- 設定頁不再提供付費模型選項；模型清單只列免費模型，舊版 localStorage／sessionStorage 的付費選擇會自動遷回免費模型。
- 沒有已儲存 API Key 時「取得免費金鑰」為紅色，有金鑰時為綠色；設定頁的「影片教學」捷徑會打開教學中心並捲到 OpenRouter API Key 影片。
- 已設定免費模型時狀態卡只顯示模型狀態；未設定金鑰時仍保留紅色設定提醒。
- 香港繁體中文及英文介面；320×640、390×844、768×1024、1280×800 及 844×390 五種視窗。
- 18 個互動停留點：`upload`、`manual`、`verify`、`items`、`fee`、`share`、`share-options`、`replies`、`payer`、`currency`、`payment`、`tax-method`、`calculate`、`report`、`report-web`、`report-fallback`、`report-share`、`detail`；第二步分享並核對回覆，第三步填結算設定後計算，第四步網頁版優先且後備文字預設收合。
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


認帳連結區兩個操作都明確標示給朋友：`複製連結給朋友`／`分享連結及附件給朋友`；繁中名稱由 `friend-recognition.cjs` 驗證。

本次 `friend-recognition.cjs` 通過 12/12，包含兩個標籤和認帳連結建立。
`friend-password.cjs` 未進入 UI：其舊 preflight 仍要求 `claim.html` 存在 `id="claim-password-repeat"`；此欄位已不存在。


R117 字體易讀性：`settings-free-models.cjs` 驗證主程式選單 A−／A／A+ 三段、中英標籤、大小級距、偏好重載保存與 320px 無水平溢出；`friend-navigation.cjs` 驗證結果頁小／標準／大三段（中間為原標準、A+ 約放大 20%）、已保存 A+ 偏好遷移、付款提醒文案及 390px／320px 手機版無水平溢出。`worker-core.test.mjs` 同時驗證既有朋友短連結會帶上 R117 結果頁 cache-busting 參數。


R118 漏人補加：`friend-recognition.cjs` 驗證結果頁按先補人、再接收、再計算的雙語指引；複製操作得到原有同一條連結；手動備援會跳至並聚焦第二步回覆欄；新朋友仍由原連結加入，主辦人接收後重新計算並更新相同結果。全部認帳 API 使用本機 mock，沒有寫入正式資料。


R119 漏人指引：`friend-recognition.cjs` 驗證結果卡預設收起、向下三角形展開、步驟文字精簡，並覆蓋同一連結複製、手動回覆聚焦、朋友新增及主辦人接收後重算。

## R120「漏咗帳單？點樣補加」
`friend-recognition.cjs` 驗證收起狀態及兩個方向，並以主程式語言選單切換繁體中文／英文，核對標題、方向、遮蓋提示、分享按鈕和追加圖片文案；同一認帳連結、手動附圖、遮蓋後加入與重新結算仍通過。`card-redaction-ui.cjs` 驗證分享及追加圖片按鈕為白色、44px，原圖不變且分享 payload 只含遮蓋 JPEG；合成卡號測試覆蓋 320px／390px、手動遮蓋／復原及 OCR 失敗時阻止分享。`recognition-retry-ui.cjs` 覆蓋圖片批次重試與分享確認。所有 API 使用本機 Worker／mock，對外寫入 0。

## R121 紅圈按鈕位置修正
`friend-recognition.cjs`、`card-redaction-ui.cjs` 和 `recognition-retry-ui.cjs` 需分別驗證上方「漏咗朋友？點樣補加」卡仍保留並預設收起，下方原「分享收據圖」位置改為另一張預設收起的「漏貼帳單？點樣補加」卡；展開後顯示「認帳單補加」及「分享帳單」。雙語標題、分享／加圖白色 44px、預設本機遮蓋與零公開 API 寫入都納入回歸。

## R122 AI 匯入後補貼原帳單
`text-import.cjs` 驗證文字／JSON 匯入無圖片時第二步顯示繁英提醒；「補貼原帳單」沿用本機遮蓋及核對，不跑 OCR／AI，保留匯入項目，補圖完成及草稿重載後提醒維持隱藏。`friend-recognition.cjs` 檢查兩個收起卡按鈕為 40–42px；`card-redaction-ui.cjs` 及 `recognition-retry-ui.cjs` 繼續覆蓋分享卡號遮蓋。

## R123 審計修正
`calculation-regressions.cjs`（本機限定）驗證：實物數量差額由墊支人承擔時，平均稅費也按墊支人及認帳人分攤；明確 `total: 0` 保持零、缺少 `total` 才以單價×數量回算；負稅費阻止產生結果並將焦點移回稅費欄。`text-import.cjs` 驗證具名刪除確認、預設聚焦「保留」、Escape／取消不刪及明確確認才刪。`tutorial-ui.cjs` 在 390px 繁中／英文畫面核對垃圾桶按鈕 accessible name 及 44×44px。API 使用本機 mock，對外寫入 0。

## R124：文案與附件狀態
`friend-recognition.cjs` 核對上方按鈕為「前往結算區」，底部實際轉步驟按鈕仍為「下一步」；並驗證分享文案、無附件時只分享連結，以及選取附件後顯示數量。`tutorial-ui.cjs` 核對金額提示 14px、稅費／折扣標籤與輸入框關聯、`inputmode="decimal"`。保持原有 A−／A／A+、配色和白色 44px 分享／加圖按鈕；另檢查 320px 和 390px 畫面。

## R125：可選本機手動認帳
`friend-recognition.cjs` 驗證手動入口預設關閉／鎖定、主動開啟後只存本機草稿、重新載入可恢復、啟用前後無認帳 API 呼叫；稍後建連結時 seed members 為空、不含手動文字，而朋友仍可經該連結提交並由主辦人正常接收。預設線上模式的完整朋友流程同樣回歸。公開測試使用 `PUBLIC_STATIC_QA=1`，所有 API 攔截到本機 Worker harness，對外寫入 0。
