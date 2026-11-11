# R103：朋友修改認帳

- [x] 同一朋友連結的結果頁提供「修改認帳」，返回原有表格並恢復數量及單位；不導向主程式。同一姓名重新提交取代舊認帳，主辦人會收到更新並重新計算。
- [x] 已提交或未提交的修改按活動保存在朋友瀏覽器，重開連結可恢復。重新提交後顯示「認帳已修改，等候重新結算」，不得將未包含新認帳的舊結果當成最新結果；更新結果仍使用原連結。
- [x] 連結到期後停用修改及提交；保留原有介面、語言切換和主辦人發布權限。不新增服務或帳戶。

驗收：8 個朋友頁流程、7 個純資料測試、既有同一連結及時鐘回歸均通過；主辦人與朋友的實際本機整合測試確認同一 session 的 $50 結果在修改、重新計算後更新為 $75。所有帳單 API 使用隔離合成資料。

# R104：姓名＋密碼保護

- [x] 首次新認帳填姓名及設定密碼。之後修改要揀同一姓名並核對密碼成功，先開放原表格及重新提交；密碼不正確時不能修改或覆蓋。驗證及個人更新由伺服器執行，不是本機姓名鎖定。
- [x] 舊連結及未設定密碼的舊認帳先由主辦人確認，再以單次確認碼綁定密碼；不容許另一個朋友搶綁。忘記密碼由主辦人核對後發出有期限確認碼重設，保留舊認帳。
- [x] 同一連結公開睇結果不需密碼；保留原介面、倒數及重新結算等待流程。只有經驗證的個人認帳可更新，主辦人仍需要原發布金鑰。密碼不放連結、結果或本機草稿；到期停止修改，錯誤嘗試限流。

驗收：26 個實際 Worker／DO 權限及儲存測試、8 個精確認帳比對測試、5 個指定 relay 純資料測試通過。手機流程驗證首次設定、錯密碼、跨姓名權限、重新載入需重新驗證、舊姓名與未知舊姓名確認碼、重設／重用拒絕及到期。實際主辦人／朋友流程以全形姓名及 1.234→1.2345 份數修改驗證同一 URL 的重新結算、舊結果等候及確認碼不落草稿；各組針對性執行通過。正式 Worker 已部署原三模組、SQLite migration 及私有 secret，結果 KV 不變。

# R105：輕量選填四位認證碼

- [x] 姓名／暱稱旁邊放四位數字「認證碼（選填）」小欄，可自行填寫或按小型「隨機」按鈕；空白可以提交，不強制密碼、不重複確認、不用大幅密碼畫面。保留原認帳表格、數量／單位、提示和一條連結。
- [x] 下次使用同一姓名找回資料；有設定認證碼的姓名需同一碼才可編輯，未設定者以姓名即可開啟。核對入口在緊湊姓名卡內；錯碼可重新輸入，不公開或保存碼在 URL／草稿／結果。未設碼的資料以姓名識別，不宣稱強身份保護。
- [x] 忘記認證碼提供小型選項重新嘗試或重新填寫（另一暱稱），不自動覆蓋有碼的舊認帳；保留原有主辦人確認碼重設作為折疊後備。現有 R104 8 字密碼可在小型舊密碼模式使用，不刪除或降級已有密碼。新認帳不再強制主辦人確認。
- [x] 同一姓名重新提交取代其舊認帳，等待主辦人重新結算後更新原連結；倒數、到期停止修改、主辦人發布權限和已有資料保持不變。沿用既有服務。

驗收：35 個後端測試及 6 組手機整合流程通過，涵蓋空白碼、前導零四位碼、錯碼、舊密碼、草稿不含碼、折疊忘記選項與另一暱稱保留舊認帳；實際主辦人重新結算後，同一 URL 的 1.234→1.2345 精確修改正確更新。正式 Worker 亦用一筆合成帳單驗證空白碼認帳／姓名找回、PIN 權限及私人收件箱。既有核心、KV、SQLite namespace 及 secret 未改動。

# R106：認證碼欄明顯縮細

- [x] 保留大姓名欄，旁邊四位認證碼改成明顯較小的格仔，標題直接顯示「認證碼（選填）」，不與姓名輸入框同大。初填及修改入口保持一致；留空照樣可用，不自動填入或催促用家設定。不改原認帳資料、四位碼驗證、同一連結及倒數；舊長密碼模式仍可正常輸入。

驗收：390／320 px 手機初填及修改畫面，小碼格均為 84×34 px，姓名欄維持 52 px 高；選填標題及小隨機按鈕清楚，沒有橫向溢出。留空可提交及找回資料，舊密碼仍可完整輸入。14 項針對性檢查通過；全部 API 使用合成回應，沒有正式帳單寫入或後端改動。

# R107：四位碼輸入焦點不移位

- [x] 輸入第四個數字、游標仍在框內時，四位碼完整顯示，第一個數字不被遮住；離開或再次聚焦顯示一致。初填和修改入口都修正，保留原本 84×34 px 尺寸，改用一個普通輸入框，不再畫四個格仔；選填及認證資料不變，逐字輸入、貼上、刪除及修改數字正常。

驗收：原因已在舊版重現為輸入值 `1234` 時 `scrollLeft=5`（字距造成內容超出小格）；R107 用一般字距、單一輸入框並置中，維持 84×34 px。390px 初填／修改流程及 320px 窄屏均測得 `scrollLeft=0`、四碼完整可見、沒有水平溢出。11 項朋友流程測試及 43 項後端／同連結比對測試通過；API 全在本機隔離測試，沒有正式帳單寫入。

# R108：首頁選單加高並增加按鈕間距

- [x] 手機右上角功能選單維持原面板寬度（w-40／160px），選單按鈕至少 44px 高、文字較易讀、按鈕間約 8px 空隙；整體主要縱向加長，避免按鈕太密、難以觸控。長文案在原寬度內換行；不改按鈕功能，若畫面窄仍不可橫向溢出。

驗收：Playwright 手機實測 390px／320px；兩種寬度面板均 160px、6 個選項全部至少 44px 高、16px 字體、8px 間距，無橫向溢出；原設定頁與選單項目操作測試通過。樣式已修正在真正覆蓋 Tailwind 的 `theme.css`，主題表單及其他版面未改。

# R109：連結有效期、可略過朋友回覆及藍色主題
- [x] 新活動認帳連結預設有效 14 日，已建立連結及明確保存的有效期不變。
- [x] 朋友尚未回覆時仍可由第 2 步前往第 3 步填墊支人和貨幣，回覆欄標示可稍後填；項目名稱及計算必要資料仍照常檢查。
- [x] 由朋友連結進入的認帳頁和分享結果頁以柔和藍色作主要 accent；主程式和主辦人本機預覽維持綠色。
驗收：Playwright 測試新活動的 14 日預設、無回覆前進再返回、朋友認帳頁及分享結果藍色、主辦人本機預覽綠色。

# R110：第三步檢視朋友認帳與報告按鈕狀態
- [x] 把第二步「認帳回覆」狀態卡及「朋友交返的認帳」文字欄移到第三步；主辦人前往第三步後即可在同頁查看／重新接收／貼上認帳，不需返回前頁；格式錯誤或未認帳數量亦可在第三步直接查看及修正。第二步仍保留認帳連結分享入口；不重複顯示回覆卡或文字欄。
- [x] 無有效朋友認帳時，第三步「產生分帳報告」按鈕維持現有淡綠色 disabled 外觀且不可按；朋友認帳有效後才啟用。第三步仍可先填墊支人及貨幣，按鈕字色與既有主程式綠色風格保持正常；繁體中文及英文均適用。
驗收：`friend-recognition.cjs` 11 項通過，涵蓋未回覆前進、第三步回覆面板、墊支人／貨幣仍可填、無回覆按鈕停用、收到有效回覆後同頁結算；`friend-navigation.cjs` 通過朋友頁與主辦人預覽隔離及 R110 結果連結版號。

# R111：第三步回覆區放到結算按鈕前
- [x] 把「認帳回覆」狀態卡及「朋友交返的認帳」輸入欄放在第三步墊支人、貨幣、付款方式及附加費用分攤設定之後，緊貼「產生分帳報告」按鈕上方；不再放在第三步頁首。
- [x] 保持按鈕啟用規則、回覆接收／手動貼上、回覆錯誤定位與現有介面細節不變；只調整回覆區位置。
驗收：`friend-recognition.cjs` R111 版位斷言及 11 項主辦人端到端測試通過；`friend-navigation.cjs` 朋友頁導航回歸通過。

# R112：結算說明、短網址及網頁首選分享
- [x] 在「產生分帳報告」按鈕內加入細字，說明按下後會計算並更新朋友原有連結；沒有已分享連結時，改為說明會產生報告。繁體中文／英文皆有對應。
- [x] 分享連結畫面只顯示含中間省略號的短網址文字，但點擊、複製及 WhatsApp 分享仍使用完整 URL。
- [x] 第四步以網頁版同一連結為「首選」並排第一；簡單版及詳細版仍可用，但收在可展開的「後備方案」內，並以中英文字說明其用途。
驗收：`friend-recognition.cjs` 11 項與 `friend-navigation.cjs` 全部通過；它們覆蓋按鈕說明、完整 href／短網址顯示、首選排序和後備方案展開。附加 OCR／貨幣舊測試有既有 fixture／文案／金額預期不匹配，未改動分帳計算。

# R113：活動名稱確認導覽與無黑色文字陰影
- [x] 黑色文字不加文字陰影或投影；保留原有可讀性及按鈕配色。
- [x] 第二步活動名稱／連結有效期設定卡右下角新增「確定」按鈕；按下後以平滑捲動前往「分享認帳連結及附件」按鈕，不建立連結、不清除可編輯的活動名稱；繁體中文及英文均可用。
驗收：`friend-recognition.cjs` 11 項通過，其中包含 smooth scroll 參數、分享按鈕可見、活動名稱仍可編輯及文字陰影為 none；`friend-navigation.cjs` 全部通過。

# R114：同步更新互動教學並保留原始示範影片
- [x] 互動教學按現行順序示範：第 2 步分享認帳連結；第 3 步依次設定墊支人、結算貨幣、付款方式及服務費分法，再檢視朋友回覆；未收到回覆仍可完成設定，但沒有有效回覆時不能產生報告。
- [x] 第 4 步以網頁版同一連結為首選；簡單版／詳細版只作後備，先展開後備方案才展示文字報告操作；繁體中文與英文文案一致。
- [x] 依使用者最新指示，第一條 OpenRouter API Key 影片保持原片；第二條分帳操作影片還原為修改前原始版本，逐位元與 R114 前資產相同。移除新增 OCR 片頭及其字幕 sidecar，不再剪輯或改動影片內容。
- [x] 主程式左上角版本文字只顯示 R114，移除 V1.0.1。
- [x] 免費 OCR cascade 以 Dots3-Note 為預設；同一遮蓋樣本六候選結果顯示件數／稅欄／部分翻譯仍錯。移除漏項及混淆結算欄的 Nano Omni，以及使用者回報失敗且本輪免費端點回覆 429 的 Gemma 4 31B／26B；Nemotron 3.5 VL 留在固定後備末位。`openrouter/free` 加入首屏及設定頁，僅手動選擇時呼叫，不混入固定 cascade，可能較慢。Crouton Alpha 不用於真實收據流程：Stealth AUP 對受適用法律／法規保障或限制分發的資料設限，並列出 financial information。六模型彙總記錄在本地基準報告。
- [ ] OpenRouter 標示 Dots3-Note 免費版本將於 2026-12-31 下架；該日期前重新確認替代免費視覺模型及遷移。
- [x] 第 1 步收據畫面可直接選 Dots、Nemotron 或免費隨機路由，與設定頁同步並保存；Playwright 驗證隨機選項持久化、隨機路由只呼叫一次，固定 cascade 不含隨機路由。
- [x] 成功重做 OCR／翻譯後，以最新項目名稱重建認帳 URL hash；保留現有 session、加密回覆 room、活動名稱及期限，並將最新結果發布至同一 session。`friend-whatsapp-details.cjs` 驗證舊、新項目名稱及 session/room/metadata。

驗收：各測試群組均獨立通過：OCR cascade 6/6、模型遷移與 random selector、OCR retry、同一連結 hash/session/room、朋友頁、雙語 18 階段教學（19 個 browser cases）、tutorial safety 2 項、Worker 授權／核心 35/35 及 diff-check。第二條影片 SHA-256 與 R114 前原始 blob 完全相同。
歷史測試限制（已解除）：friend-revisions 舊版 mock 未涵蓋目前的認帳 API；本輪改用現行 `/claims/status`、`/claims/unlock`、`/claims/submit` contract 後，8/8 通過，沒有放寬產品授權邏輯。


## R114 OCR supplement follow-up (2026-11-08)

- [x] 首頁預設選擇 PaddleOCR.js PP-OCRv5 WASM 本機辨識＋Dots3-Note；新訪問者及 v4 以前設定（包括目前已保存的 OpenRouter 路徑）一次性遷移至此組合，偏好版本 5 起用家明確選擇的 OpenRouter 路徑會保留。首頁與設定頁的模型選項、選中值及逐路由說明同步，繁中／英文內容一致。
- [x] 首頁新增外部 AI 讀圖提示詞複製按鈕及貼上／上載文字入口；正確格式 JSON 免鎖匙本機匯入，一般文字交給所選免費模型，互動教學第 1 階段已同步說明。
- [x] 外部 AI 提示詞明確要求優先交付一個可下載的 UTF-8 `bill.json` 檔；若其他 AI 介面不能附檔，則一次輸出完整、可整段複製的 JSON，並在匯入區提示使用者複製整段回覆。中英雙語提示已由 `text-import.cjs` 驗證。
- [x] 外部 AI 回覆只含文字／JSON時，可在第 2 步或結果頁另選原收據圖片；沿用本機遮蓋介面並把遮蓋後照片連回當前帳單，不會重新 OCR 或傳送給 AI，可用既有本機草稿、歷史和圖片分享功能。合成照片 E2E 驗證附加後重載仍保存。
- [x] 同一張遮蓋收據已完成 Tesseract.js、PaddleOCR CPU、PaddleOCR.js、OCR.space Engine 2/3 的零費用可執行測試；PDF 中 17 個候選均已逐項調查，不把需註冊、帳單或未明確免費的試用額度當成 $0 實測。
- [x] `friend-revisions.cjs` mock 已同步現行 `/claims/status`、`/claims/unlock`、`/claims/submit` API；8/8 回歸通過。
- [x] R114 現行範圍回歸完成，本機 OCR 補充功能已發布至 GitHub Pages；測試範圍、commit 及舊版 R104 測試說明見下方。


## R114 public deployment (2026-11-08)

- GitHub Pages workflow `42490619449` completed successfully for commit `4b9038bc214807bd9b3def05baed26e79edd89a8`; the live index and `paddle-ocr-local.js` were fetched successfully, and the visible app version remains R114.
- Current-scope regression passed: 35 Worker tests, 19 bilingual tutorial browser cases, 2 tutorial-safety cases, 11 current friend-recognition cases, 8 friend-revisions cases, Paddle local data-flow/settings, OCR retry/sharing, and same-link hash/session/room checks.
- The legacy `friend-password.cjs` R104 harness still asserts a removed repeat-password field and mandatory owner approval, which conflict with the later R105 optional-PIN/no-mandatory-confirmation requirements. Legacy-password compatibility is covered by current `friend-recognition.cjs` and Worker authorization tests.


## R114 same-origin Paddle models and test reliability (2026-11-09)

- [x] PaddleOCR.js now fetches both official PP-OCRv5 Mobile model tar archives from this site's origin, only when the first local scan runs; the service worker caches these same-origin assets at runtime. The archives total 21,544,960 bytes (about 21.5 MB) and include the upstream Apache 2.0 license.
- [x] The shared home/settings model description tells Traditional Chinese and English users about the approximate first-scan download size; visible app release remains R114 while PWA cache and loader URLs receive the new build token.
- [x] Real Chromium inference loaded both model tar files from the app origin (HTTP 200), made no request to Paddle's archive host, and sent text only to the mocked Dots3-Note endpoint. On the redacted sample, 4 of 5 tracked numeric values were recognized; the cash amount `3000` was missed, so the existing human-review step remains important.
- [x] Tutorial E2E uses the actual compressed Tailwind Play CDN v3.4.17 script under its MIT license, preserving real CSS/layout assertions. The tutorial remains 18 stages with both original video files unchanged.
- [x] Regression passed: v4-to-v5 settings migration and selector sync; text/JSON import with attachment and persistence; 19 tutorial browser cases; 2 tutorial-safety cases; Paddle mock and real inference; OCR retry; card redaction; same-link hash/session/room; 6 OCR cascade unit tests.


## Add a participant after results are published

- [x] A friend who opens the original protected claim link after results are ready can clearly start a fresh claim under another name and submit their own items without editing or deleting existing claims.
- [x] The organizer's result page explains how to receive the late claim, recalculate, and update the result on the original link; manual-reply users are shown the supported name/item format.
- [x] The late-add flow is available in Traditional Chinese and English and is covered end-to-end with the real local claim Worker harness, with no public API writes.


## Inline receipt photos on the original result link

- [x] After external AI text/JSON import, users can add the original receipt in Step 2 and redact it locally; this photo does not run OCR or go to any AI service.
- [x] When the result is shared or updated, the redacted photo is stored in the same existing share session and appears below the bill on that original result link; do not create a separate photo link or require a second URL.
- [x] The UI explains this in Traditional Chinese and English, and the local Worker E2E proves the original URL, persisted image, and inline friend view without public API writes.

- Evidence: `tests/text-import.cjs` and `tests/friend-recognition.cjs` passed with synthetic receipts; the Worker harness recorded zero public API writes.
- The friends' detail iframe displayed the redacted image inside the original shared session URL, under the bill.
- The inline-photo and bill.json prompt changes were published on GitHub Pages before this picker update; the picker release is tracked below.


## Android Downloads receipt picker and accordion arrow

- [x] Receipt-file buttons use the secure-context File System Access picker with `startIn: "downloads"` when available; supported formats remain JPEG/PNG/WebP and existing client validation remains authoritative.
- [x] Browsers without that API fall back to an unfiltered file input so the user can navigate to Downloads instead of being sent straight into an image-only media picker.
- [x] The external-result accordion follows the shared `Accordion`: down-chevron while collapsed, up-chevron while expanded; bilingual E2E covers Downloads options, fallback, and both states.
- Evidence: `text-import.cjs` passed the Downloads option, file-type filter, unfiltered fallback, chevron direction, bilingual prompt, and local import-persistence checks.
- Evidence: `paddle-local-ocr-ui.cjs` passed the primary receipt picker and image-to-text-only boundary; `card-redaction-ui.cjs` confirmed the existing masking path.
- Other regression: settings E2E passed; tutorial UI passed 19 browser cases; tutorial safety passed 2 cases; OCR cascade passed 6 unit tests.


## R114 短文案與替代流程分隔（2026-11-09）

- [x] 收據 OCR 與外部 AI 匯入、拍照／手動輸入兩組同級替代流程均顯示「或」；相機／選圖、JSON 匯入／手動輸入、複製／分享等既有替代處也維持一致。
- [x] 精簡紅圈所示繁中：草稿狀態、OCR 重試與模型摘要、外部 AI 匯入、活動名稱／有效期、稅費折扣、朋友認帳與同連結結果；英文提示保留，結算和分享資料流程不變。
- [x] 可見版本仍為 R114；PWA 與 service worker cache token 更新為 `v114-concise-copy-or-20261109`。
- [x] Playwright 通過：`text-import.cjs`、`recognition-retry-ui.cjs`、`friend-recognition.cjs`（12 項）。
- [x] 補充回歸：`friend-navigation.cjs`、`friend-whatsapp-details.cjs`、`settings-free-models.cjs` 均通過。


## R114 模型說明收合與外部 AI 翻譯文案（2026-11-09）

- [x] 模型說明預設隱藏，首頁與設定頁只顯示下箭嘴；按箭嘴才顯示目前所選模型說明，再按可收起；更換模型時自動收起，其他模型的說明不攤開。
- [x] 外部 AI 區標題改為「搵其他 AI 幫手翻譯」，副標題改為「提示詞＋賬單＝專用翻譯檔（.json）」；英文同步更新。
- [x] 更新 PWA／service worker cache token 為 `v114-model-details-ai-translate-20261109`；可見版本仍是 R114。


## R114 第二步停留與兩段式下一步導覽（2026-11-09）

- [x] 收據 OCR、外部 AI 純文字／JSON 匯入成功後進入第二部分，停在審閱區頂端，不再自動滑到認帳分享區；外部 AI 匯入的原收據附加卡顯示在頂部供用家先補相片。
- [x] 活動名稱／連結期限區的「確定」改為「下一步」（英文 Next）；點擊後不直接進第三部分，而是以約 1.8 秒動畫移至原有底部綠色「下一步」，用家再自行繼續。
- [x] 使用者可用觸控、滑鼠滾輪或鍵盤中斷慢速移動；遵守 reduced-motion 系統偏好。
- [x] 更新 PWA／service worker token 為 `v114-concise-ui-copy-20261109`；可見版本仍是 R114。
- [x] Playwright 通過：`friend-recognition.cjs`（第二步頂部／附圖／慢速 CTA 及 12 項分享回歸）、`recognition-retry-ui.cjs`、`text-import.cjs`、`friend-navigation.cjs`、`friend-whatsapp-details.cjs`、`settings-free-models.cjs`。


## R114 第四部分結果頁極簡文案（2026-11-09）

- [x] 精簡附圖、同步狀態、補加朋友、網頁分享、後備報告、簡易／詳細報告、存檔和導覽按鈕；縮短重複說明並保留分享可見範圍及本機相片的隱私短註。
- [x] 報告只保留姓名、項目、金額、匯率和付款資料；同步繁中／英文短標籤與操作回饋，不改分帳計算、圖片處理或分享 payload。
- [x] 更新 PWA／service worker token 為 `v114-concise-ui-copy-20261109`；可見版本仍為 R114。
- [x] 通過回歸：文字／JSON 附圖、PaddleOCR UI、OCR 重試、朋友分享／WhatsApp、跨幣別報告、教學 19 個瀏覽器案例及教學安全。

## R114 第二步恢復狀態與後加圖片極簡化（2026-11-09）

- [x] 恢復狀態只顯示「已恢復」；不再重複說明賬單可繼續使用或草稿已存本機。錯誤與正在儲存時保留必要提示。
- [x] 審閱區移除「AI 已讀好」、來源模型等說明，只留項數和總額。
- [x] 外部 AI 匯入的附圖卡只留「後加圖片」按鈕；有相片時才顯示張數。
- [x] 簡易結果保留總額；換幣時只顯示「原幣 → 結算額」，不丟失關鍵金額。
- [x] 通過繁英恢復狀態、單鍵附圖、OCR/JSON 重讀、跨幣別總額、相片本機保存提示及朋友分享回歸。


## R114 朋友連結操作按鈕文案（2026-11-09）

- [x] 上方標示「複製連結給朋友」；下方標示「分享連結及附件給朋友」；兩者都清楚說明收件人是朋友，並保留操作差別。
- [x] 同步英文「Copy link for friends」與「Share link and files with friends」。
- [ ] 驗證認帳連結與密碼保護流程的按鈕名稱及既有建立功能。
- 驗收註記：`friend-recognition.cjs` 通過 12/12，並驗證兩個按鈕名稱及連結建立。`friend-password.cjs` 在 UI 啟動前被既有靜態檢查擋下（它仍要求 `claim.html` 含已不存在的 `id="claim-password-repeat"`），未到達本次按鈕流程。


## R114 付款提醒與字體放大（2026-11-09）

- [x] 將「付款後通知收款人」改為「付款後請通知收款人」。
- [x] 在朋友分帳結果頁頂部新增易點按的 A+ 按鈕；按下後全頁文字放大約 20%，按 A− 可還原，偏好在同一瀏覽器記住。
- [x] 保持手機版不水平溢出；按鈕有清晰的繁中／英文輔助標籤與按下狀態。
- 驗收：`friend-navigation.cjs` 通過；驗證付款提醒文案、A+／A−比例、繁英輔助標籤、重載保存偏好，以及 390px／320px 無水平溢出。


## R115：認帳回覆回到第二步及四步色彩

- [x] 將「認帳回覆」及「朋友交返的認帳」兩個面板放回第二步；第三步只保留墊支人、貨幣、付款方式、費用分攤及產生報告。計算仍依賴同一份認帳資料，沒有重複面板。
- [x] 從第三步錯誤提示、結果頁捷徑及互動教學進入認帳時，正確返回第二步；繁體中文及英文流程一致。
- [x] 四個主步驟使用互相易辨、低飽和的灰紫／紫／琥珀／淺綠色提示，覆蓋目前主要工作區及步驟導覽；保持全站品牌綠與主按鈕綠色。
- [x] 更新 `index.html`、`theme.css`、`tutorial.js` 的 cache-busting token 及 service worker cache epoch；PWA 可載入新 UI，對外版本標示仍保留 R114。
- [x] 更新主辦人流程、朋友更新流程、互動教學及安全 E2E 的步驟假設，驗證無有效認帳時報告停用，回覆到達後仍可結算。
- 驗收：`friend-recognition.cjs` 12/12、`tutorial-ui.cjs` 19 個 browser cases（繁中／英文、多尺寸）、`tutorial-safety.cjs` 2 項及 `friend-navigation.cjs` 全部通過；涵蓋 Step 1–4 色彩、認帳面板唯一位置、回跳、停用條件及同連結重新結算。`node --check` 與 `git diff --check` 通過；沒有對外 API 寫入。

## R116：朋友連結高對比與英數符號認證碼
- [x] 認帳及朋友結果連結沿用藍色主題；把近白表面調為中階藍灰，卡片、欄位和主要控制使用深藍 1px 輪廓；焦點框維持深色，主辦人本機預覽不受影響。
- [x] 認證碼可留空，或輸入 4 個可列印 ASCII 字元（英文字母大小寫、數字、符號；大小寫敏感、不含空格）；欄位改用文字鍵盤並關閉自動大寫。
- [x] 隨機碼改用均勻抽樣的字母／數字／符號字元；服務端同樣驗證格式，仍只保存雜湊，不改 rate limit、舊 PIN／密碼兼容或既有認帳。
- [x] 更新靜態資產、分享 URL、PWA release 與 service-worker cache epoch；公開 R114 產品版本字樣不變。
- [x] 本機驗收：Worker 單元測試 35/35、認帳 Playwright 12/12、朋友結果頁導航／配色 E2E 全部通過；測試 API 全部使用本機模擬，沒有寫入真實帳單。
- [x] 已推送 GitHub Pages，並以 content-only API 更新現有 Cloudflare Worker；不改 KV／Durable Object／secret／設定。
- [x] 正式驗收：Pages workflow `42636289717` 成功，公開頁 HTTP 200 並載入 R116 資產；Worker modules SHA-256 與已測試來源吻合，`GET /health` 回應 HTTP 200 `ok`。沒有對正式帳單或 KV 執行寫入。

## R117：三段字體大小
- [x] 主程式選單提供「小／標準／大」三段字體大小選擇，A−／A／A+ 清楚顯示目前選擇；標準為預設，可用於照顧老花眼用家。
- [x] 主程式大小選擇記存在本機，重新開啟後保留；不干擾帳單草稿、OCR 設定和認帳資料。
- [x] 朋友成績頁由原本兩段調整為三段；保留目前標準字級為中間選項，另有較小和較大選項，並記住朋友端所選級別；舊版已選大字的偏好會遷移為「大」。
- [x] 繁體中文及英文頁面都可辨識級別，三段控制可在窄手機螢幕操作，文字放大不造成橫向溢位。
- [x] 新認帳連結、同連結成績 iframe、既有短連結 redirect 及 PWA 快取均指向新版本字體控制。
- [x] 本機驗收：`settings-free-models.cjs`、`friend-navigation.cjs`、`friend-recognition.cjs` 全部通過；Worker core/auth 36/36 通過；JS syntax 與 `git diff --check` 通過。測試無外部 API 寫入。
- [x] GitHub Pages workflow `42667912975` 成功，公開 index／detail／claim／theme／PWA 資產均 HTTP 200；正式 HTML 包含三級字體控制和 R117 cache token。
- [x] Cloudflare content-only 更新既有 `bill-splitter-share` Worker；三個 modules 的部署 SHA 已核對，其中 `worker-core.mjs` 與測試來源 hash 相同。唯讀 `GET /health` 回應 200 `ok`；虛構短碼 redirect 回 302 並帶 R117 版本參數。
- [x] 公開 Pages 上的 `friend-navigation.cjs`、`friend-recognition.cjs` 通過；API 全部 mock，沒有對正式認帳資料或 KV 寫入。

## R118：結果頁漏人補加一條龍
- [x] 結果頁先提供真正的補人入口：複製同一條連結給漏掉的朋友，讓朋友按「新增一位」填姓名及認帳；不要先顯示只會跳頁的「認帳」掣。
- [x] 朋友交回後，主辦人可由結果頁觸發「接收新認帳」；直接返回第二步並接收，收到新回覆後自動到第三步重新計算；未有新回覆時仍留在收件區並可再試。
- [x] 提供手動補填後備：直接跳至第二步「朋友交返的認帳」輸入欄並聚焦，貼上後可返回第三步重新計算。
- [x] 中／英文均按先補人、再接收、再計算的次序寫清楚；所有按鈕描述其實際動作，原有朋友認帳與結果連結保持不變。
- [x] 本機 `friend-recognition.cjs` 12/12 通過：精確連結複製、手動欄位聚焦、原連結新增朋友、主辦人接收及重新發布均驗證；外部寫入 0。
- [x] GitHub Pages workflow `42723350524` 成功，commit `ce23fbb` 已上線；正式首頁含 R118 指引及三個操作，index／PWA／SW／theme／tutorial 資產均 HTTP 200。
- [x] 公開頁面 `friend-recognition.cjs` 12/12 與 `friend-navigation.cjs` 全部通過；`PUBLIC_STATIC_QA=1` 將所有 API 留在 mock，正式認帳／帳單寫入 0。

## R119：漏人補加指引預設收起
- [x] 「漏人補加」指引預設收起；收起時只顯示精簡標題及向下三角形，需要時按一下才展開。
- [x] 展開後的指引文字和操作標籤要精簡；保留「複製同一連結給朋友 → 接收新認帳 → 第三步重新計算」及手動貼上後備流程。
- [x] 繁體中文及英文均可看到同一個收起／展開控制，原有連結、接收、手動貼上與重算行為不變。
- [x] R119 cache token 已更新；本機 `friend-recognition.cjs` 12/12 通過，涵蓋預設收起、三角形展開、短文案及所有操作。
- [x] GitHub Pages workflow `42726408591` 成功，commit `d3d0510` 已上線；R119 首頁及 theme／PWA／tutorial 資產 HTTP 200。
- [x] 公開 `friend-recognition.cjs` 12/12 通過；`PUBLIC_STATIC_QA=1` 全程 mock API，正式認帳／帳單寫入 0。

## R120：漏咗帳單雙方向
- [x] 收起卡標題改為「漏咗帳單？點樣補加」；展開後分成「1. 認帳單補加」與「2. 分享帳單」兩個清楚方向。
- [x] 把帳單圖分享按鈕移進第二方向，改白色並縮至 44px 觸控高度；沿用同一連結和遮蓋邏輯。已有圖片時仍可分享或再加圖片；新增按鈕同樣為白色 44px。
- [x] 現有帳單圖分享時預設在本機自動遮蓋卡號，只分享遮蓋副本；新增相片則明確提示先在本機遮蓋、核對後加入，不冒稱自動辨識。
- [x] 保留中／英文、預設收起和精簡說明；無現有圖片時仍提供安全的後加圖片操作。
- [x] 本機 E2E 覆蓋兩方向、按鈕白色／44px、預設自動遮蓋、手動補圖與原有認帳重算；`friend-recognition.cjs` 12/12、`card-redaction-ui.cjs`、`recognition-retry-ui.cjs` 通過。雙語切換驗證標題、方向、遮蓋說明及追加圖片文案；所有 API 留在本機／mock，對外寫入 0。
- [x] 更新 R120 cache token；`node --check` 及 `git diff --check` 通過。
- [x] Commit `fb0a60e` 已推送至 `main`；[GitHub Pages workflow 42733068421](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42733068421) 成功，公開首頁 HTTP 200，已確認 R120 cache token 及中英標題。
- [x] 公開網址 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 12/12 通過，覆蓋雙方向、語言切換、同一連結及本機遮蓋後加圖；所有認帳 API 路由至本機 harness，正式資料對外寫入 0。

## R121：修正紅圈按鈕的替換位置
- [x] 保留原本的「漏咗朋友？點樣補加」收起卡及其認帳流程。
- [x] 將截圖紅圈圈住的綠色「分享收據圖」按鈕位置改為預設收起的「漏咗帳單？點樣補加」卡；展開後保留「認帳單補加」及「分享帳單」兩方向。
- [x] 分享及加圖按鈕維持白色、44px；卡號遮蓋仍預設開啟，新增圖片在本機遮蓋並由用家核對。
- [x] 更新 R121 cache token；本機 `friend-recognition.cjs` 12/12、`card-redaction-ui.cjs`、`recognition-retry-ui.cjs` 通過，涵蓋兩卡收起、位置、雙語、遮蓋與分享確認；`node --check` 和 `git diff --check` 通過。
- [x] Commit `2065386` 已推送至 `main`；[GitHub Pages workflow 42736451247](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42736451247) 成功。公開首頁確認 R121 token，首頁、theme、PWA、Service Worker、tutorial、結果頁和認帳頁均 HTTP 200。
- [x] 公開網址 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 12/12 通過，驗證漏朋友卡保留、新漏帳單卡位置／雙方向／雙語及同連結加圖；API 全部攔截至本機 harness，對外寫入 0。

## R122：AI 匯入漏貼帳單提醒與收起卡高度
- [x] 文字／JSON 匯入後如未有帳單圖片，第二步即時提示補貼原帳單；照片沿用本機遮蓋／核對、不做 OCR／AI 的入口，且保留匯入項目。
- [x] 有圖片後自動隱藏提醒；結果頁標題改為「漏貼帳單？點樣補加」／“Forgot the bill photo?”。
- [x] 朋友卡及帳單卡收起按鈕縮至 40px，收緊容器上下留白；白色 44px 分享／加圖按鈕不變。
- [x] PWA／Service Worker token 升至 R122；`text-import.cjs`、`friend-recognition.cjs` 12/12、`card-redaction-ui.cjs`、`recognition-retry-ui.cjs` 本機回歸通過；`node --check` 及 `git diff --check` 通過，所有 API 使用本機 mock。
- [x] Commit `f60d7c1` 已推送至 `main`；[Pages workflow 42747383201](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42747383201) 成功。公開首頁及 theme／PWA／Service Worker／tutorial／結果頁六項資產均 HTTP 200；live HTML 含 R122 cache token、中英提醒及「漏貼帳單」新標題。
- [x] 公開網址 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 12/12 通過，驗證新標題、40px 收起卡、雙方向及同連結流程；所有 API 攔截至本機 harness，對外寫入 0。提醒匯入／補圖互動另由四組本機 E2E 覆蓋。

## R123：審計確認項修正
- [x] 平均稅費按所有實際分攤對象計算，包含由墊支人承擔未認帳實物數量時新增的墊支人。
- [x] 明確帳單項目總額 `0` 保持零；只有總額缺失／空白時，才以單價乘數量回算。
- [x] 計算分帳時拒絕負稅費；雙語錯誤顯示在欄位旁、`aria-invalid` 正確，並返回第二步聚焦稅費欄。
- [x] 刪除項目先顯示含項目名稱的確認對話框；預設焦點放在保留，取消或 Escape 不改資料。
- [x] 垃圾桶按鈕提供繁中／英文可存取名稱及手機 44×44px 觸控目標。
- [x] 未建分享連結前認帳輸入區的現行鎖定行為保持不變；未在未確認前改動流程。
- [x] 本機回歸通過：`calculation-regressions.cjs` 3/3、`text-import.cjs`、`tutorial-ui.cjs` 19 個 browser cases、`friend-recognition.cjs` 12/12、`card-redaction-ui.cjs`、`recognition-retry-ui.cjs`；`node --check` 與 `git diff --check` 通過，所有業務 API 均為本機 mock。
- [x] Commit `b0b5777` 已推送至 `main`；[Pages workflow 42768783270](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42768783270) 成功。
- [x] 公開首頁 R123 token／主要提示字串已確認；theme、PWA、Service Worker、tutorial、結果頁及認帳頁六項資產均 HTTP 200。公開 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 12/12 通過，API 全部攔截至本機 harness，對外寫入 0。

## R124：介面易讀與分享狀態
- [x] 上方只負責捲動的按鈕改為「前往結算區」，真正轉步驟的底部按鈕仍顯示「下一步」。
- [x] 分享按鈕明示認帳連結為主、附件可選；未選附件清楚提示只分享連結，選取後顯示附件數量。
- [x] 稅費／折扣標題以 `label` 正式連結輸入框，金額欄加 decimal input mode；金額提示字級至少 14px。
- [x] 簡化調整說明的內嵌框線；保留原色彩、白色 44px 分享／加圖按鈕及 A−／A／A+ 三級字體設定。
- [x] 本機回歸通過：`friend-recognition.cjs` 12/12、`tutorial-ui.cjs` 19 個 viewport／互動案例、`text-import.cjs`、`settings-free-models.cjs`；涵蓋雙語、附件空／已選、label 關聯、decimal input mode、14px 提示及 320／390px 版面。
- [x] Commit `9676ea4` 已推送至 `main`；[Pages workflow 42773053984](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42773053984) 成功。公開首頁、theme、PWA、Service Worker、tutorial.css／js、結果頁及認帳頁均 HTTP 200，R124 token 與繁中核心文案已確認。
- [x] 公開網址 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 12/12 通過；所有帳單 API 攔截至本機 harness，對外寫入 0。

## R125：可選本機手動認帳
- [x] 第二步認帳輸入預設仍鎖定；只新增收起的手動入口，須用家主動選擇才啟用。
- [x] 手動回覆寫入本機活動草稿；啟用、編輯及重新載入不呼叫帳單 API。
- [x] 後建分享連結時不預填／上傳本機手動回覆；連結建立後朋友回覆仍能正常接收，舊線上流程保留。
- [x] index／PWA／Service Worker cache token 升至 `v125-manual-claim-mode-20261110`。
- [x] 本機 `friend-recognition.cjs` 13/13、`text-import.cjs`、`card-redaction-ui.cjs`、`calculation-regressions.cjs` 3/3 通過；`node --check` 和 `git diff --check` 通過，所有 API 使用 Worker harness，外部寫入 0。
- [x] Commit `84d7865` 已推送至 `main`；[GitHub Pages workflow 42779205241](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42779205241) 成功。公開首頁、`pwa.js`、`sw.js` 均 HTTP 200；live HTML 確認 R125 token 及繁中／英文入口文案。
- [x] 公開網址 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 13/13 通過：本機模式不建立／呼叫線上收件、不把回覆帶入後建連結；原線上朋友認帳仍正常，外部寫入 0。

## R126：後續審計修正
- [x] 商品認領編號在刪除／OCR 重認後保持穩定；刪除已認領項目會警告，舊回覆不會重映射到其他商品。
- [x] 有價格的商品未認領時禁止產生結果，並在第二／三步保留提示；只有姓名、無有效認領的人不加入稅費分母。
- [x] 稅費分幣按有效分攤者分配；換匯後逐人應付及總額守恆，舍入差額在主報告和朋友明細清楚列出，總額／個人應付移至第四步頂部。
- [x] 匯入負稅與無效稅額會拒絕，手動稅費於失焦／下一步驗證；開新單前先保存本機草稿並確認，取消或儲存失敗均不清除原資料。
- [x] 更新手動認帳格式提示及模式狀態、表單 label、狀態列語義與教學焦點控管；小字體下的狀態按鈕、收合卡和刪除目標維持 44／40px。
- [x] index／PWA／Service Worker、教程與分享頁 cache token 升至 `v126-followup-audit-20261110`；可見產品標籤為 R126。
- [x] 本機測試通過：`receipt-adjustments.test.cjs` 24/24、離線匯率單元測試 5/5、`calculation-regressions.cjs` 10/10、`friend-recognition.cjs` 13/13（外部寫入 0）、`recognition-retry-ui.cjs`、`text-import.cjs`（含背景點按不刪除）、`settings-free-models.cjs`、`tutorial-ui.cjs` 19 項、`tutorial-safety.cjs`、`cross-currency-ui.cjs`、`card-redaction-ui.cjs`；語法與 `git diff --check` 通過。
- [x] Commit [`131ff8f`](https://github.com/cw91020251212/bill-splitter-ai/commit/131ff8f8139f2c00ea1db6189baf2e8ddbad7cfe) 已推送到 `main`；[GitHub Pages workflow 42802936889](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42802936889) 成功，Pages 状態為 `built`。
- [x] 公開首頁、`pwa.js`、`sw.js`、`theme.css`、`tutorial.js`、`detailed-view.html` 全部 HTTP 200；已確認 R126／`v126-followup-audit-20261110` 與繁中／英文手動認帳文案。公開 `PUBLIC_STATIC_QA=1` 的 `friend-recognition.cjs` 13/13 通過，所有帳單 API 走本機 mock，外部寫入 0。

## R127：複查問題與草稿安全修正
- [x] 商品匯入、手動編輯及舊草稿恢復共用非負／有效金額與正數數量檢查；有效 JSON 的商品／稅費／折扣錯誤不會降級成外部 AI 請求，明確零元仍受支援。
- [x] 一致化頂層折扣與明細折扣的負號規則；未提交收據文字納入本機草稿、取消保留與新單確認後清除。
- [x] 舊認領草稿在重新結算前要求逐項核對；OCR 重認按唯一商品規格配對同名項目，歧義時發新編號，並阻止舊認帳錯套。
- [x] 第二步顯示商品欄位錯誤；設定／歷史畫面隱藏不適用的舊結算狀態；功能選單、A−／A／A+ 及認帳輸入提供 44px 或欄位輔助說明。
- [x] index／PWA／Service Worker cache epoch 升至 `v127-recheck-audit-20261110`；可見版本升至 R127。
- [x] 本機測試：`receipt-adjustments.test.cjs` 25/25、離線 `exchange-rates.test.cjs` 5/5、`calculation-regressions.cjs` 14/14（帳單 API 呼叫 0，含負數量顯示與修正）、`friend-recognition.cjs` 13/13（外部寫入 0）、`text-import.cjs`、`recognition-retry-ui.cjs`（同名不同規格／歧義案例、8 次 mock OCR）、`cross-currency-ui.cjs`、`friend-whatsapp-details.cjs`、`settings-free-models.cjs`、`tutorial-ui.cjs` 19 項、`tutorial-safety.cjs`、`card-redaction-ui.cjs` 均通過。
- [x] 升級 R127 後再次通過設定 UI 測試；所有 JavaScript 檔 `node --check` 與 `git diff --check` 通過。
- [x] 推送前確認遠端 `main` 與本機一致；Commit [`10beb68`](https://github.com/cw91020251212/bill-splitter-ai/commit/10beb6897562309adeebab6b3a9ced07e57ced67) 已推送。Pages workflow [42833333248](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42833333248) 成功；公開首頁、PWA、Service Worker、樣式、教程及詳細結果頁全部 HTTP 200，R127 token 正確；公開朋友認帳 live smoke 13/13 通過，所有業務 API 使用本機 mock，外部寫入 0。

## R128：手機版排版與操作層級
- [x] 手機斷點內整理頂欄與單行步驟列、留白及首頁標題；拍照／選圖、貼文字／JSON、手動輸入均以主要觸控尺寸前置；辨識設定預設收起，缺少鎖匙提示保持單行。
- [x] 第二步先顯示總額／項數，再開始商品清單；第一件商品在 y=260px 前；手動認帳入口緊接商品清單，補圖和活動／分享設定收起在後；只調整手機 DOM 呈現順序與 CSS。
- [x] 維持既有綠／紫配色；不修改計算、認帳或分享處理程式，桌面版不變。
- [x] `tests/mobile-layout.cjs` 覆蓋 320×844、390×844、320×700、大字模式、橫向溢出、首頁入口及觸控目標、匯入後總額／清單首項、手動認帳順序，以及 1280px 桌面版幾何基準。
- [x] index／PWA／Service Worker 及朋友連結令牌升至 `v128-mobile-layout-20261111`；可見版號 R128。
- [x] 本機實測：三種手機尺寸均無橫向溢出；影相起點 y=198，文字區底 y=308，手動入口底 y=366。匯入後顯示 `$68.00`／2 項，首項 y=200（320 大字）或 y=187（390 及 320×700）；可見按鈕觸控區至少 44×44px。大字步驟列維持單行；1280px 桌面頂欄、步驟列、辨識卡、上載區及第二步清單座標均不變。
- [x] 核心回歸：`calculation-regressions.cjs` 14/14；`friend-recognition.cjs` 13/13（帳單 API 全本機 mock、外部寫入 0）；`cross-currency-ui.cjs`、`friend-whatsapp-details.cjs`、`card-redaction-ui.cjs` 均通過。文字匯入、設定、OCR 重認、互動教程 19/19、安全教程 2/2 亦通過；修改檔語法與 `git diff --check` 無錯。
- [x] 官方 Playwright 文件確認 `getByTestId` 使用 DOM `data-testid`，`.click()` 等待可見／穩定／可接收事件；先前 OCR E2E 超時不是 Playwright 已知 bug，而是測試進入第三步後錯點僅屬第二步的返回控件。已改按手機實際路徑逐步返回。[Locator 指南](https://playwright.dev/docs/locators) [click/actionability API](https://playwright.dev/docs/api/class-locator) [可見性斷言](https://playwright.dev/docs/api/class-locatorassertions)。
- [x] R128 程式提交 `99569af` 已推送至 `main`；[GitHub Pages workflow 42883834064](https://github.com/cw91020251212/bill-splitter-ai/actions/runs/42883834064) 成功。
- [x] 公開首頁、`pwa.js`、`sw.js`、`theme.css`、`tutorial.js`、`detailed-view.html` 均 HTTP 200；公開首頁及 PWA／Service Worker 均驗證 `v128-mobile-layout-20261111`，公開網址為 https://cw91020251212.github.io/bill-splitter-ai/。

## R129：朋友連結重算同步
- [x] 根因確認：Cloudflare KV 跨區讀取可能沿用舊快取；朋友頁一顯示 ready 即停止輪詢，已開啟頁不會察覺主辦人後續重算。
- [x] 每個認帳活動沿用既有 SQLite Durable Object 儲存最新結算結果及單調遞增 revision；結果按 512 KiB chunks 儲存，KV 保留相容鏡像。舊活動首次讀取時會安全地由既有 KV 結果補種 DO。
- [x] `/api/shares/{id}` 由 DO 提供最新結果，`?meta=1` 只回輕量 revision；朋友頁每 6 秒檢查版本，只在版本變更時重載內嵌報告，不更換連結，也不覆蓋未送出的編輯。
- [x] 重算同步狀態不再錯顯示「已同步」；待同步／失敗時可按 44px「立即同步／重試」。
- [x] 手機步驟列補回四點進度：完成／目前／未到階段可區分；仍只顯示目前步驟文字並保持 36px 高。320px、390px、短屏、大字及桌面幾何 E2E 通過。
- [x] 驗收：Worker/DO 36 個單元測試通過；`friend-recognition.cjs` 16/16，包含本地 Worker/DO、邊緣 KV 保留舊值、已開啟朋友頁自動刷新及編輯中的未提交認帳保護；`mobile-layout.cjs` 320×844、390×844、320×700 與桌面幾何測試全部通過。
- [x] R129 Pages 已上線並驗證（提交 `e2f911d`）；Cloudflare Worker 部署仍待授權。

## R130：新手流程提示與手機四步導航
- [x] 手機第一步顯示四個有名稱、編號及狀態的步驟按鈕；已完成步驟可點回查看／修改，向前跳轉仍遵守原有資料檢查。桌面導航保持原狀。
- [x] 未設定 Key 時，在第一步清楚顯示相片及一般文字辨識需要 Key、JSON／手動輸入可免 Key；提供直接打開申請教學的入口，辨識設定保持收起，且不遮住其他輸入方式。
- [x] 在 320×844、390×844、320×700 和大字體下，步驟名稱不換行、沒有橫向溢位，觸控區至少 44×44px；相機／選圖仍在首屏靠前，文字／手動入口仍清晰可見。
- [x] 驗收：`mobile-layout.cjs` 通過三種手機尺寸、大字體及桌面幾何；`tutorial-ui.cjs` 19/19、`friend-navigation.cjs`、`settings-free-models.cjs`、`friend-whatsapp-details.cjs`、`friend-recognition.cjs` 16/16，Worker/DO 36/36，所有改動檔語法與 `git diff --check` 通過。
- [x] Cache epoch `v130-mobile-onboarding-20261111`、可見版號 R130；已推送 main（`d48910f`），Pages workflow `42943712688` 成功。公開首頁、PWA、Service Worker 與 CSS 均為 R130；公開 390px 手機實測四階段、Key 教學直達、相機 y=204px 且無橫向溢位。

## R131：首訪完整引導與手動收合偏好
- [x] 首次使用直接展開免費 Key 設定／申請教學、其他 AI 翻譯方式與模型說明；手機首屏副標題明確提及「其他 AI 翻譯」，不再依賴用家猜測或先找隱藏面板。
- [x] 第二步補貼收據、分享／認帳設定及結果頁補人、補帳、簡易／詳細後備，首次可見並可用箭嘴手動收合／重開；手動選擇存在本機，下次沿用；不改計算、OCR、認帳資料或分享內容。
- [x] 保留 320×844、390×844、320×700 及大字體手機版的相機優先、44px 觸控與無橫向溢位；桌面四步導覽、原色系和卡片尺寸保持，加入緊湊的 44px disclosure 標題；固定底部狀態欄不遮擋第二步最後操作。
- [x] 驗收：`mobile-layout.cjs` 三種手機尺寸／大字體／桌面 geometry 通過；`text-import.cjs`、`settings-free-models.cjs`、`tutorial-ui.cjs` 19/19、`card-redaction-ui.cjs`、`recognition-retry-ui.cjs`、`friend-navigation.cjs`、`friend-whatsapp-details.cjs`、`friend-recognition.cjs` 16/16 均通過；Worker/DO 36/36、JavaScript syntax、`git diff --check` 均通過。
- [x] 推送 R131 至 GitHub main（`a660424`）；Pages workflow `42955156385` 成功。公開 390×844 驗證教學中心返回後可見首次展開的 Key／其他 AI 指引，手動收合後重新載入會沿用偏好。

## R132：精確恢復 R128 前的原有介面
- [x] 以 R128 commit `99569af` 的直接父提交 `82b7f89`（R127 原始介面）作基準，還原完整四步進度、原本第一步和第二步順序及桌面／手機樣式；與該基準相比只保留 R129 同步狀態提示和必要版本更新，沒有重新設計版面。
- [x] 只移除 R128–R131 的介面變更；保留同一認帳連結重算同步、朋友頁 revision 更新、未送出認帳保護及 Worker／DO 強一致結果功能。R127 本來存在的面板狀態原封保留，不加 R131 新偏好記憶。
- [x] 本機 E2E：`mobile-layout.cjs`（320×844、390×844、320×700、桌面及舊版第二步順序）、`friend-recognition.cjs` 16/16、Worker／DO 36/36、`tutorial-ui.cjs` 19/19、`calculation-regressions.cjs` 14/14、設定、文字匯入、卡號遮蓋、OCR 重試、朋友導航及 WhatsApp 分享均通過。
- [x] 推送 R132 至 GitHub Pages（程式提交 `6b2a8fe`；workflow `42963920365` 成功）。公開頁 R132 在 320×844／390×844 確認四步進度、Key 申請教學及 AI 翻譯入口；390px 實際匯入後確認原第二步次序，沒有瀏覽器錯誤。收合改良留待第二階段另行討論。

## R133：縮短步驟列與選擇性收合長指引
- [x] 四個步驟按鈕把序號與兩字短名排在同一行，標籤使用「睇單／認帳／運算／結果」；降低導覽高度、保留進度條、可點返回、完整無障礙名稱與至少 44px 觸控尺寸。
- [x] 只為低頻或長篇指引提供清楚箭嘴及收合：缺 Key 的申請說明、AI 翻譯與模型說明首次展開；手動開／收後在本機記住選擇。收起後標題、狀態和主要入口仍可見。拍照／選圖、手動輸入、項目、活動設定和主要分享操作不收起。
- [x] 在 320px、390px、700px 高手機畫面及桌面驗收步驟列、收合偏好與主要流程；mobile-layout、設定、匯入、教程、卡號遮蓋、OCR 重試、朋友導航／WhatsApp、計算（14/14）、同鏈結朋友流程（16/16）和 Worker／DO（36/36）均通過。
- [x] 推送 R133（`14d83b0`）；GitHub Pages workflow `42972773146` 成功。公開 390px 手機頁顯示 R133，四步按鈕各 46px、導覽列 75px、無橫向溢位，AI 說明收起後重載仍記住，頁面錯誤 0。

## R134：模型選擇與鎖匙說明一併收合
- [x] 把第一步「今次辨識用邊個模型？」的模型選單及模型說明搬進上方「鎖匙設定」旁的同一展開內容；使用同一箭嘴即可同時展開／收起鎖匙指引與模型選項，收合後整組模型內容不可見。
- [x] 保留首次引導、使用者手動收合偏好、至少 44px 觸控及原有模型預設／保存行為；不改 OCR、計算、認帳、分享或第二步／設定頁模型選擇。
- [x] 驗收：`mobile-layout.cjs` 通過 320×844、390×844、320×700 及桌面，覆蓋共同箭嘴收合／重開及重載記憶；`settings-free-models.cjs`、`paddle-local-ocr-ui.cjs`、`text-import.cjs` 均通過；`node --check` 和 `git diff --check` 通過。
- [x] 推送 R134（`f2aaf99`）；GitHub Pages workflow `42981846105` 成功。公開手機頁確認首訪展開、收合後重載維持收起、再展開可切換模型，320px 沒有橫向溢位，頁面錯誤 0。

## R135：精簡首頁單據圖片區
- [x] 手機收據圖片空白狀態移除大圓形插圖和多餘高度，只顯示「最多選 5 張圖片」提示；「直接影相」和「選擇圖片」並排，保留「或」及每個按鈕至少 48px 高度。桌面維持原有插圖、說明和按鈕布局。
- [x] 保留圖片選擇、拍照、既有 5 張限制、上次圖片重用及讀取錯誤說明；不改 OCR、分析、計算、認帳、分享流程。
- [x] 手機 320px／390px、短畫面及桌面回歸，提示完整、按鈕同列、沒有橫向溢位且空白圖片區不超過 180px。320px 測得卡片 131px、按鈕各 72px（文字自然換行，沒有縮字）。
- [x] 驗收：`mobile-layout.cjs`、`settings-free-models.cjs`、`paddle-local-ocr-ui.cjs`、`text-import.cjs`、`card-redaction-ui.cjs`、`recognition-retry-ui.cjs` 均通過；桌面圖示與提示保留，照片遮蓋、批次重試及失敗保留舊結果通過；JavaScript syntax 及 `git diff --check` 通過。
- [x] 推送 R135（`b51c99a`）；Pages workflow `42984921789` 成功。公開手機頁 320px 高 131px、390px 高 115px；兩尺寸皆為同列 52px 以上按鈕，桌面原圖示與分隔保留，零水平溢位及頁面錯誤。

## R136：首頁圖片和 AI 文案精簡
- [x] 圖片選擇提示標明「收據／帳單圖片」，並保留最多 5 張的限制；桌面原圖示和説明不變。
- [x] 在「搵其他 AI 幫手翻譯」標題右側平排小字 Gemini、豆包及省略號；不表示為程式內置或保證可用的模型。
- [x] 把第一步長說明改為小字單行「以下三種方法處理單據：」，手機 320px／390px 不換行或橫向溢出；翻譯功能、圖片辨識和三個輸入入口正常。
- [x] 驗收：`mobile-layout.cjs` 於 320×844、390×844、320×700、1280×900 通過；AI 範例與標題同列且省略號收尾（320px 字級 13.5／10px、390px 15／11px），不橫向溢出。`text-import.cjs` 與 `settings-free-models.cjs` 通過，JavaScript syntax 及 `git diff --check` 通過。
- [x] 推送 R136（`36c6ec6`）並驗收正式頁：320px、390px 和 1280px 均為 R136；手機例子同列、不溢出，桌面維持原插圖及流程。

## R137：加大 AI 範例字並加入 ChatGPT
- [x] 標題右側例子加上「e.g.」，包含 Gemini、ChatGPT、豆包及省略號；390px 時例子字級由 R136 的 11px 放大至 13px。
- [x] 360px 以上例子與短標題同列、不壓到箭嘴、不橫向溢出；320px 時可自然分行而非縮至難讀。桌面維持易讀版面。
- [x] AI 匯入流程及中英文顯示正常；本機 `mobile-layout.cjs`、`text-import.cjs`、`settings-free-models.cjs` 和語法／diff 檢查通過；版本 R137 及 PWA／SW cache epoch 已更新。
