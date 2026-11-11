## R128：手機版排版精簡

只調整手機畫面：首頁頂欄與步驟列收緊，拍照、選圖、貼文字及手動輸入更早出現；辨識設定預設收起。第二步把總額和商品清單前置，手動認帳緊接清單，補圖與活動／分享設定收起至後方。維持既有配色；不改計算、認帳、分享邏輯，桌面版位置保持不變。PWA cache epoch：`v128-mobile-layout-20261111`。

## R128: Mobile layout polish

Mobile-only layout changes bring the camera, image picker, text/JSON import and manual-entry actions onto the first screen, with recognition settings collapsed by default. Step 2 now leads with the bill total and item list, followed immediately by manual claims; receipt-photo and activity/share settings stay collapsed below. Existing colors remain. Calculation, claims and sharing behavior are unchanged, and desktop geometry is preserved. PWA cache epoch: `v128-mobile-layout-20261111`.

## R129：同一朋友連結同步最新結果

主辦人重新計算後，最新結果以每個活動的 Durable Object 作強一致版本來源；朋友原有連結不變，已開啟的結果頁會檢查輕量版本號並自動更新。KV 保留作相容鏡像；PWA cache epoch：`v129-shared-link-sync-20261111`。

## R129: Same friend link, latest recalculated result

After the organizer recalculates, the per-session Durable Object serves the strongly consistent latest result. The friend URL stays unchanged, and an already-open result page checks a lightweight revision and refreshes automatically. KV remains a compatibility mirror. PWA cache epoch: `v129-shared-link-sync-20261111`.

## R130：手機新手導覽與 Key 引導

手機步驟列顯示四個有名稱的階段，已完成步驟可點回查看／修改；未設定 Key 時，拍照前有明確提示，並提供申請教學，以及文字／JSON／手動輸入的 Key 使用說明。手機按鈕保持至少 44px，桌面版幾何與配色不變。PWA cache epoch：`v130-mobile-onboarding-20261111`。

## R130: Beginner-friendly mobile guidance

The mobile stepper names all four stages and lets users revisit completed steps. When no Key is configured, the photo action gets a clear prompt, a direct application guide, and a concise explanation of text/JSON/manual alternatives. Mobile controls remain at least 44px; desktop geometry and colors are unchanged. PWA cache epoch: `v130-mobile-onboarding-20261111`.

## R131：新手資訊先展開，熟手可收起

首次使用會直接看到免費 Key 申請教學、其他 AI 翻譯的三步說明，以及第二步和結果頁的重要操作指引；每個區塊都有清楚箭嘴。使用者手動收合或重開後，偏好只保存在本機並於下次沿用。首頁仍先顯示相機入口，桌面保留四步流程與既有配色。PWA cache epoch：`v131-first-run-disclosures-20261111`。

## R131: First-use guidance with remembered controls

First-time visitors see the free Key guide, the three-step workflow for using another AI to translate a bill, and the important Step 2/results instructions. Each section has a clear chevron; manual open/close choices are saved locally and reused next time. The camera remains the first action, and the existing desktop workflow and palette are preserved. PWA cache epoch: `v131-first-run-disclosures-20261111`.

## R127：复查問題與草稿安全修正

拒絕負數／無效商品金額和數量，並在第二步清楚顯示錯誤；有效 JSON 的稅費、折扣或商品資料錯誤時不會改送 AI。未提交的單據文字會留在本機草稿，取消新單可保留，確認新單則一併清除。舊草稿會先要求核對認領編號；OCR 重認可按唯一商品規格沿用編號，無法安全配對時改用新編號並阻止舊認帳錯套。設定／歷史頁不再顯示過期的結算狀態，字級選項及頂部功能選單均有至少 44px 觸控範圍。PWA cache epoch：`v127-recheck-audit-20261110`。

## R127: Recheck and draft-safety fixes

Invalid or negative item amounts and quantities are rejected, with a visible Step 2 error. Semantically invalid JSON is never downgraded to an AI request. Unsubmitted receipt text stays in the local draft; cancelling a new bill preserves it, while confirming a new bill clears it. Older drafts require explicit claim-ID review. OCR retries preserve IDs only when a duplicate-name item has a unique matching specification; ambiguous items get new IDs and old claims cannot silently attach elsewhere. Settings and History no longer show a stale result status, and the text-size controls and top action menu have at least 44px touch targets. PWA cache epoch: `v127-recheck-audit-20261110`.

## R126：審計後續修正

修正審計發現的認領錯位、漏算金額和草稿清除風險：商品認領編號在刪除及重新識別後保持穩定；仍有未認領金額時禁止產生報告，只有姓名而沒有有效認領的人不參與稅費分攤。稅費分幣與最終換匯舍入會分配並明示，結果頁先顯示全單總額及各人應付。匯入負稅會被拒絕；開新單前先保存本機草稿並要求確認，取消可保留原資料。另修正手動認帳提示、狀態欄可存取操作、表單標籤及小字體觸控尺寸。PWA cache epoch：`v126-followup-audit-20261110`。

## R126: Follow-up audit fixes

Fixes claim mis-mapping, omitted bill amounts and accidental draft loss: item claim IDs stay stable through deletion and re-recognition; reports are blocked while a priced item remains unclaimed, and name-only replies do not enter the tax split. Tax cents and final currency-conversion rounding are allocated and disclosed; the result page puts the bill total and each person’s payable amount first. Imported negative tax is rejected. Starting a new bill saves the local draft first and asks for confirmation; cancelling preserves the existing data. Manual-mode guidance, status-button accessibility, form labels and small-text touch targets are also improved. PWA cache epoch: `v126-followup-audit-20261110`.

## R125：可選本機手動認帳

第二步認帳輸入仍預設鎖定；新增一張預設收起的「本機手動輸入」卡，只有用家主動選擇才解鎖。手動回覆保存在本機活動草稿，不建立分享連結、不呼叫認帳 API，也不會在稍後建立連結時預填到線上成員。其後朋友仍可照常經原連結提交、主辦人接收並重算；未選手動模式的舊流程不變。PWA cache epoch：`v125-manual-claim-mode-20261110`。

## R125: Optional local manual claims

The Step 2 claim field remains locked by default. A collapsed “Enter claims locally” option unlocks it only when selected. Manual replies are stored in the local activity draft; they do not create a link, call the claim API, or seed online members if a link is created later. Friends can still submit through the existing link and the host can receive and recalculate normally. The default online flow is unchanged. PWA cache epoch: `v125-manual-claim-mode-20261110`.

## R124：文案、附件狀態與金額輸入清晰度

上方只負責捲動至結算區，改名「前往結算區」；底部真正進入下一步仍標示「下一步」。分享文案明示認帳連結為主、附件可選；無附件時說明只會分享連結，選取後顯示附件數。稅費／折扣標籤連結輸入框並使用小數鍵盤；金額提示字級 14px，調整說明改為單側強調條。保留既有配色、白色 44px 分享／加圖按鈕和 A−／A／A+ 控制。PWA cache epoch：`v124-ui-clarity-20261110`。

## R124: Clearer copy, attachment state and amount inputs

The upper button only scrolls to settlement, so it now says “Go to settlement”; the bottom action that actually advances remains “Next.” Sharing copy makes the claim link primary and attachments optional. The dialog says when only the link will be shared and shows the attachment count after selection. Tax/discount controls gain associated labels and decimal input mode; amount guidance is 14px, and the receipt-adjustment note uses a lighter accent strip. Existing colors, white 44px share/photo buttons, and A−/A/A+ controls remain. PWA cache epoch: `v124-ui-clarity-20261110`.

## R123：分帳計算與刪除確認修正

修正三項計算邊界：平均稅費涵蓋所有實際分攤者（包括代墊未認帳實物數量的墊支人）、明確總額 `0` 不再被單價×數量覆蓋、負稅費不能產生結果。刪除項目改為顯示名稱的確認對話框，預設聚焦「保留」；垃圾桶按鈕具繁英 accessible name 及 44×44px 觸控目標。分享連結前的認帳輸入限制維持不變。PWA cache epoch：`v123-issue-audit-fixes-20261110`。

## R123: Split-calculation and deletion safeguards

Fixes three calculation edge cases: equal tax includes every actual cost bearer (including a payer covering unclaimed physical units); an explicit item total of `0` is no longer replaced by price × quantity; and negative tax cannot produce a report. Item deletion now asks for confirmation by item name, with the safe “Keep” action focused by default. The trash button has localized accessible names and a 44×44px touch target. The current claim-input gate before creating a share link is unchanged. PWA cache epoch: `v123-issue-audit-fixes-20261110`.

## R122：AI 匯入後提醒補貼原帳單

文字／JSON 匯入而沒有帳單圖片時，第二步即時提示補貼原帳單；遮蓋／核對後，朋友可在同一結果連結查看。此流程不重跑 OCR，也不改動已匯入項目。結果頁標題改為「漏貼帳單？點樣補加」。朋友及帳單兩張收起卡縮至 40px；分享／加圖按鈕仍為白色 44px。PWA cache epoch：`v122-imported-bill-photo-reminder-20261110`。

## R122: Prompt for the original bill photo after text import

If text or JSON items are imported without a bill photo, Step 2 prompts the user to attach the original. After local redaction and review, friends can view the photo on the same result link. The action does not rerun OCR or change imported items. The result guide is renamed “Forgot the bill photo?” Both collapsed controls are 40px; sharing and photo actions remain white and 44px. PWA cache epoch: `v122-imported-bill-photo-reminder-20261110`.

## R121：紅圈按鈕改成漏咗帳單指引

保留原本的「漏咗朋友？點樣補加」卡；將紅圈圈住的「分享收據圖」按鈕位置改成預設收起的「漏咗帳單？點樣補加」，展開後有「認帳單補加」及「分享帳單」兩個方向。卡號仍預設在本機遮蓋，分享與加圖按鈕為白色 44px；繁中／英文支援不變。產品標籤維持 `R114`；PWA cache epoch 為 `v121-bill-guide-target-fix-20261110`。

## R121: Move the bill guide to the circled share button

Keep the original “Missing someone? Add them” card. Replace the circled “Share photos” button at its original position with a collapsed “Missing a bill? How to add it” guide containing “Add a claim” and “Share bill”. Card numbers remain masked locally by default; share and add-photo actions stay white and 44px. The product badge remains `R114`; the PWA cache epoch is `v121-bill-guide-target-fix-20261110`.

## R120：漏咗帳單？點樣補加

展開後有兩個方向：「認帳單補加」及「分享帳單」。現有帳單圖分享前預設在本機自動遮蓋卡號，只分享遮蓋副本；已有圖片時仍可追加圖片，新圖片會在本機遮蓋並先核對。分享與加圖按鈕均為白色、44px 高。產品標籤維持 `R114`；PWA cache epoch 為 `v120-bill-share-two-directions-20261110`。

## R120: Missing a bill? How to add it

The expanded guide has two paths: add a missing claim or share the bill. Existing bill photos are scanned and card numbers are masked locally before sharing by default; only redacted copies are shared. Users can add more photos; each new photo is masked locally and reviewed first. Share and add-photo buttons are white and 44px high. The product badge remains `R114`; the PWA cache epoch is `v120-bill-share-two-directions-20261110`.

## R119：漏人補加指引預設收起

結果頁的漏人補加指引預設收起，只顯示「漏咗朋友？點樣補加」和向下三角形；按下才顯示精簡的分享同一連結、接收新認帳、第三步重算及手動貼上操作。產品版本標籤維持 `R114`；PWA cache epoch 為 `v119-collapsed-missing-person-guide-20261110`。

## R119: Collapse the missing-person guide by default

The result page keeps the missing-person guide collapsed, showing only a short title and a downward triangle. Tapping it reveals concise actions to share the same link, receive new claims, recalculate in Step 3, or paste a reply manually. The product badge remains `R114`; the PWA cache epoch is `v119-collapsed-missing-person-guide-20261110`.

## R118：結果頁漏人補加

結果頁按次序說明「先補人、再接收、再計算」：主辦人可複製同一條連結給漏掉的朋友，朋友按「新增一位」填姓名及認帳；提交後，主辦人可接收新回覆，核對後到第三步重新計算。另可直達第二步手動貼上回覆。產品版本標籤維持 `R114`；PWA cache epoch 為 `v118-missing-person-followup-20261110`。

## R118: Add a missing friend from the result page

The result page now guides the organizer through “add first, receive next, recalculate last.” They can copy the same link to the missing friend, who taps “Add person” and submits their name and claims. The organizer can then receive the new reply and recalculate in Step 3, or jump directly to the Step 2 reply box for manual entry. The product badge remains `R114`; the PWA cache epoch is `v118-missing-person-followup-20261110`.

## R117：三段字體大小

主程式「選單」加入 A−／A／A+，可直接選小、標準或大字；標準為預設，字體級別記存在本機。朋友成績頁亦改為三段選擇，中間 A 為原本標準大小，另可選小字或大字；保留過往已選 A+ 的偏好。兩頁均適用繁體中文及英文，並按 320px 手機寬度驗收。朋友短連結和認帳頁內嵌成績亦帶新版本參數。產品版本標籤維持 `R114`，PWA cache epoch 為 `v117-readable-text-3-levels-20261110`。

The main menu now offers A− / A / A+ for small, standard and large text, with standard selected by default and the choice saved locally. The friend result page also has three direct choices; A is its previous standard size, and the previous A+ preference is preserved. Both pages support Traditional Chinese and English and were checked at a 320px mobile width. Friend links and the embedded result use the new cache-busting version. The product badge remains `R114`; the PWA cache epoch is `v117-readable-text-3-levels-20261110`.

## v114：互動教學更新（示範影片保持原片）

互動教學依照現行四步流程更新：第二步分享認帳連結，第三步先設定墊支人、貨幣、收款方式及服務費分法，再核對朋友回覆；第四步以原認帳連結中的網頁結果為首選，簡單版與詳細版收在後備方案。OCR 預設為免費 Dots3-Note；單一遮蓋樣本仍發現件數、稅欄和個別品名錯誤，不能宣稱完全準確，結果須人工核對。Nemotron 3 Nano Omni 在同一樣本漏項並混淆結算資料，已移除；Gemma 4 31B／26B 按使用者回報失敗移除，本次免費端點亦均回覆 429；Nemotron 3.5 VL 留在固定後備末位，但仍非可靠首選。首屏和設定頁可選 Dots、Nemotron 或 OpenRouter 免費隨機路由；隨機路由只在手動選取時呼叫，可能較慢，不會混進固定後備。舊 Nano 選擇遷移回 Dots。成功重做辨識後會以最新項目名稱刷新認帳 URL hash，保留原 session、回覆 room 及活動資料，再發布最新結果。兩段示範影片均還原為 R114 前原始影片，不再剪輯。主程式標籤維持 `R114`，PWA 快取 `v114-ocr-random-router-option`。

The interactive guide follows the current four-step flow: share the claim link in Step 2, configure payer/currency/payment/fee split before reviewing replies in Step 3, and prefer the web result on the original claim link in Step 4. Dots3-Note remains the free OCR default; one masked sample still showed quantity, tax-field and translation errors, so outputs need review. Nano Omni mixed settlement data into items and has been removed. Gemma 4 31B/26B remain removed per the user's failures and both free endpoints returned 429 in this run. Nemotron 3.5 VL remains last in the fixed fallback order, but is not considered reliable. The first-screen and Settings pickers offer Dots, Nemotron, and OpenRouter's free random router; the random route is called only when selected manually and may be slower. Saved Nano selections migrate back to Dots. After successful re-recognition, the claim URL is rebuilt with current item names while preserving its session and reply room, then the latest result is published. Both tutorial videos remain byte-identical to their pre-R114 originals; no video editing is being continued.

OpenRouter 官方目前標示 Dots3-Note 免費版本將於 2026 年 12 月 31 日下架，應在此日期前重新評估替代模型（[模型頁](https://openrouter.ai/dots-studio/dots-3-note-preview:free)）。`openrouter/free` 現在列為可手動選擇的隨機模型；它會從相容免費模型中隨機選擇，可能較慢，也可能落到使用者回報失敗的 Gemma，因此不參與固定自動後備（[路由文件](https://openrouter.ai/docs/guides/routing/routers/free-router)）。

OpenRouter currently lists the Dots3-Note free variant as going away on December 31, 2026, so its replacement should be re-evaluated before then ([model page](https://openrouter.ai/dots-studio/dots-3-note-preview:free)). `openrouter/free` is now a manual random-model option. It chooses among compatible free models, may be slower, and may pick a Gemma variant the user reports failing, so it stays outside the fixed automatic fallback ([router documentation](https://openrouter.ai/docs/guides/routing/routers/free-router)).

## v112：網頁版結果分享設為首選

第三步「產生分帳報告」按鈕內有細字說明：已有朋友連結時，按下會計算並更新結果，朋友可在原連結查看；尚未建立分享連結時，則說明會產生報告。第四步把「首選・網頁版」同一條朋友認帳及結果連結放最前。超長網址只在畫面上縮短並以省略號省去中段，點擊、複製及 WhatsApp 分享仍使用完整網址。簡單版和詳細版保留作後備，收在可展開的「後備方案」中。主程式 `R112`，PWA 快取 `v112-web-result-first`。

## v111：朋友認帳區移到結算按鈕上方

第三步先填墊支人、貨幣、收款方式及附加費分攤方式；「認帳回覆」狀態卡與「朋友交返的認帳」輸入欄放在這些設定之後，緊貼「產生分帳報告」按鈕上方。回覆接收、手動貼上、計算按鈕狀態及其餘介面不變。主程式 `R111`，PWA 快取 `v111-step3-replies-before-report`。

## v110：第三步查看朋友認帳

主辦人在第二步分享認帳連結後，可直接前往第三步查看認帳接收狀態、重新接收或貼上朋友回覆，不必在頁面間來回切換；格式錯誤及未認帳數量也會在第三步提示，可直接定位並修正。無有效朋友認帳時，「產生分帳報告」按鈕維持淡綠停用狀態，但墊支人及貨幣仍可先填；收到並解析回覆後按鈕才會啟用。第二步只保留分享入口，不重複顯示回覆欄。主程式 `R110`，PWA 快取 `v110-step3-friend-replies`。

## v109：朋友連結藍色主題及可稍後貼回覆

新活動認帳連結預設有效 14 日；已建立的連結及明確保存的期限不變。主程式第二步的朋友回覆欄改為選填：即使朋友尚未回覆，也可先去下一步填墊支人和貨幣，之後再回來貼回覆；項目名稱及計算必要資料仍照常檢查。認帳頁和朋友分享結果頁以柔和藍色作主要 accent，方便和綠色主程式區分；主辦人本機預覽保持綠色。主程式版本 `R109`，快取 `v109-blue-friend-link-flow`。

## v108：首頁選單更易按

保留頂部選單原本 160px 寬度，選單項目字體調至 16px、最小高度增至 44px，列與列之間加到 8px，讓手機觸控更容易。長文字會在原寬度內自然換行；不改選單操作及其他頁面。

## v107：輸入四位碼時完整顯示

修正小認證碼欄在游標停於末尾時，首位數字被字距及水平捲動遮住的問題。保留原本 84×34 px 尺寸，改成一個普通小輸入框，不再刻意分成四格；四碼置中顯示並可正常聚焦編輯。不改認證碼、選填或同一連結流程。新回歸測試涵蓋逐字輸入、貼上、刪除、重打、失焦及重新聚焦。主程式 `R107`，快取 `v107-code-focus-visible`。

## v106：認證碼再縮細

姓名欄保持原尺寸；旁邊四位認證碼縮為 84×34 px 小格，標題直接寫「認證碼（選填）」，提示簡化為「認證碼可以唔填。」隨機按鈕亦縮細，放在碼格旁。初填及修改入口一致，舊長密碼模式仍保留較闊欄位。只改介面及快取版本 `v106-small-optional-code`，不改已有認帳、選填規則、期限或同一連結；主程式 `R106`。

## v105：姓名旁邊選填四位認證碼

沿用原認帳表格，姓名／暱稱旁邊加細小四格「認證碼（選填）」；可自行輸入或按「隨機」，空白亦可提交，不再強制八字密碼或重複確認。下次以同一姓名找回資料：未設碼可直接開啟，有碼則需輸入原碼。修改入口亦用緊湊姓名卡，不再佔用大型密碼畫面。

「忘記認證碼？」提供重新輸入及另一暱稱重新填寫；不會因此覆蓋有碼的原認帳。原主辦人重設功能收進折疊後備，舊 R104 密碼可用「使用舊密碼」模式，原資料不刪除或自動降級。認證碼不放進連結、結果或草稿；四位碼只是輕量防誤改，未設碼只按姓名識別，不是身份驗證。重新提交、等候重算、期限倒數及同一結果連結不變。主程式 `R105`，快取 `v105-optional-code`。

## v104：姓名＋密碼保護個人認帳

朋友首次新認帳設定至少 8 字密碼；結果頁揀姓名後按「修改認帳」，要先向伺服器核對密碼成功，先開放原有表格。重開修改頁要重新驗證，不把密碼或編輯 token 寫入連結、結果或本機草稿。新認帳及修改都由既有 Worker 驗證及保存；主辦人只接收已驗證更新，不再用公共推送直接覆蓋個人認帳。結果仍然公開可看，重新結算仍更新原連結。

舊連結及未設定密碼的舊姓名不能搶先綁定。主辦人更新主程式後會保留舊認帳並啟用保護；在「認帳密碼管理」輸入姓名，核對本人後產生一次性設定／重設確認碼，私下交給該朋友。朋友以確認碼設定密碼，原認帳不會被清空；忘記密碼亦用同一流程。確認碼有短期限，密碼錯誤次數限流，到期不能修改。保留現有網站、Cloudflare 帳戶及 KV 結果資料，使用既有 Worker 內的 SQLite Durable Object 做同名序列化，不要求朋友註冊或安裝。主程式 `R104`，快取 `v104-claim-password`。

## v103：朋友可返回修改認帳

同一認帳連結的结果頁新增「修改認帳」：返回朋友原有表格，保留姓名、數量與單位；既有連結沒有本機保存時，可從已發布的分帳資料恢復。重新提交沿用同一姓名並取代舊回覆，輸入及等候狀態按活動保存在朋友瀏覽器。提交修改後顯示「認帳已修改，等候重新結算」，只有結果已包含新認帳數量及實際單位時才重新展示，避免誤把舊結果當成最新結果。主辦人收到更新後會提示重新產生報告；新結果仍更新到原連結。到期後停止修改及提交。全部取消可用明確的加密撤回訊息，不影響其他朋友。此版不新增帳戶、服務或發布權限；其他成員資料的可見範圍仍沿用原分享方式。主程式版本標記 `V1.0.1 · R103`；快取版本 `v103-edit-friend-claims`。

## v102：朋友結果頁不再連去主程式

共用結果頁頂部改為不可點擊的「分帳結果」，載入中、成功或失效時均不提供主程式返回入口；只有主辦人本機預覽保留「返回分帳報告」。空白分享 ID 亦不會回退讀取本機預覽。同一朋友連結內的結果 iframe 加上新版頁面參數，主程式顯示 `V1.0.1 · R102`。修改不影響原認帳連結、期限、結算或主辦人 token 權限。回歸測試：`tests/friend-navigation.cjs`。快取版本：`v102-friend-only-navigation`。

## v101：設定置頂、計算自動更新原連結

第二步頂部直接顯示活動名稱及連結有效期，不再藏在全部項目和稅費欄下方。建立認帳連結後，主辦人按「產生分帳報告」會自動把最新結果更新到同一 session；頁首顯示同步狀態，失敗可重試，不需額外發第二條結果連結。主頁重新接入原本未載入的 PWA 更新程式，顯示 `V1.0.1 · R101`，選單新增「更新程式（保留帳單）」。更新會保留本機草稿與附件，不會刪除其他 GitHub Pages 程式快取。快取版本：`v101-visible-single-link`。

## v100：期限倒數改用伺服器時間

新認帳連結會先向現有 Cloudflare Worker 取得伺服器時間和權威到期時間，再用單調計時器顯示倒數；完成校時前暫不開放認帳表，裝置時鐘錯誤不會令有效連結提早失效。Worker 仍會在資料期限後拒絕存取。快取版本：`v100-server-synced-expiry`。

## v99：認帳及結果共用同一條連結

朋友只需收到一條連結：先填認帳並提交，發起人仍在原主程式收集資料和計算；發起人按「把結算結果更新到同一條連結」後，朋友重開原 URL 便會在同一頁看到詳細結果，不必再收第二條結果連結。主辦人的更新密鑰只存於建立活動的本機草稿，永不放進朋友連結；共用結果仍使用現有 Cloudflare Worker/KV，按活動設定 1、3、7 或 14 日到期。認帳頁把「單位」標在單位下拉選項正上方，並在每項數量欄下顯示「冇單位大家分，有單位自己付。」快取版本：`v99-same-claim-result-link`。

## v98：認帳連結活動名稱與期限倒數

主程式第二步可為每次聚餐／旅行輸入活動名稱（留空時用建立連結的本地日期和時間），並選擇 1、3、7 或 14 日有效期。朋友打開連結後會看到活動名稱與剩餘時間；到期後認帳表和提交按鈕會停用。期限使用分享端寫入連結的到期時間，朋友裝置以本地時鐘倒數；舊格式連結仍可開啟。Service Worker 快取版本：`v98-claim-link-expiry`。

## v88：精簡已設定模型提示

移除首頁第 1 步已設定免費模型狀態卡下方的兩行提示，保留模型狀態標題及未設定金鑰時的紅色提醒。快取版本：`v88-remove-key-status-hint`。

## v87：設定頁加入 API Key 影片捷徑

無已儲存 API Key 時，「取得免費金鑰」連結顯示紅色；有已儲存金鑰時保持綠色。「API 服務供應商」標題旁新增精簡的「影片教學」捷徑，會打開教學中心並直接捲到 OpenRouter API Key 影片。保留免費模型設定、教學中心和 16 個互動步驟。快取版本：`v87-api-key-video-shortcut`。

## v86：移除可能收費的模型選項（本機 review）

設定頁移除「進階／可能產生費用」整項，模型清單只提供免費模型。舊版已啟用付費模型的設定會自動改回預設免費模型；API 金鑰及其他設定保留。快取版本：`v86-free-models-only`。尚未發布。

## v85：教學文字精簡（本機 review）

移除教學中心兩段長說明，並精簡影片及互動教學描述。快取版本：`v85-short-tutorial-copy`。只更新本機 review，尚未發布。

## v84：影片優先教學中心（本機 review）

教學入口只保留兩個目錄：先是「👍 必看影片教學」，依次提供 OpenRouter API Key 影片和分帳操作影片；其次是既有 16 步互動教學。影片不會自動播放，首次使用只引導至此頁一次，亦可略過；之後用家可自行從「教學」開啟。舊四步概覽、七步截圖頁及重複文字新手教學已由本機 review 版移除。快取版本：`v84-video-first-tutorial-hub`。此版本只供本機預覽，尚未發布。

## v81：OpenRouter 教學改用七步手機截圖

保留互動導覽和文字新手教學的既有入口，只把文字教學內的 OpenRouter 專區改為連結至七步手機截圖頁。七張用戶提供的實際截圖離線預快取；新頁標明第六步的完整 Key 欄已不透明遮蓋、第七步使用空白本機設定畫面。保留「API key 不代表模型免費」提醒，並讓已快取的截圖教學在離線時可直接開啟。快取版本：`v81-openrouter-screenshot-guide`。

## v79：互動導覽加入 OpenRouter 金鑰教學入口（歷史版本）

此版本曾將 OpenRouter 說明放在文字教學內。v81 已整段移除該舊教程，只保留一個連結至七步手機截圖頁；互動導覽與其他文字教學不變。

## v75：四步互動教學

右上角「教學」現改為逐步導覽，參考 Pure-reader-hk 的高亮與自動展開方式，但仍屬本專案，不會發布到閱讀器專案。四步依次為上載睇單、各自認帳、分帳運算、最終結果；第 2 步會分別展示項目編輯、分享選項及朋友認帳欄。「詳細說明」保留原本的文字教學。

教學使用獨立、唯讀、記憶體內的示範帳單，原 App 保持掛載；不讀取 API 鎖匙、不開相機、不發連結、不儲存示範。完成或中途關閉會還原原本步驟、欄位、展開狀態、捲動位置及焦點。`tutorial.js`／`tutorial.css` 是新增的必要靜態檔案，需連同 `index.html`、`sw.js` 部署；快取版本為 `v75-interactive-tutorial`。沒有新增建置步驟。

可重跑的瀏覽器及離線測試見 [tests/README.md](tests/README.md)。自動測試使用 Chromium；真正 iPhone Safari／Android WebView 及軟鍵盤行為仍應在實機確認。

> **v49 淺綠版**：以正式 v48 為基礎，保留應付總額突出排版與報告格式，只提亮按鈕、圖示及金額綠色。主漸變由左下 `#49b88b` 至右上 `#b5f2cf`；快取版本 `v49-light-green`。正式網站：https://cw91020251212.github.io/bill-splitter-ai/ 。以下保留先前版本記錄。

# v47 中性灰白版

本版將外圍灰底提亮為中性灰白 #f8f8f8，步驟帶改為 #fdfdfd，未選步驟及一般次級白色操作改用純白，灰綠陰影改為淡中性灰。主要內容卡、輸入、認帳卡、報告與收據工作區維持純白；深綠邊線、藍／琥珀提示、紅色錯誤和綠色漸變主按鈕均保留，不修改任何功能。語言鍵仍是右上至左下的斜線，教學維持開書圖示。此版已獲授權提交至 GitHub，產品標籤維持 V1.0.1。手機預覽及驗收見 [MOBILE_TEST.md](MOBILE_TEST.md)。

認帳頁的數量旁有可選單位箭頭，預設不選單位；0.5／1／2 繼續沿用原有份數。已知單據總量時可選相符的實際單位；未知總量不猜測、不改原有份數分攤。另加入鍵盤避讓，填妥數字後讓下一題移到軟鍵盤上方，不強行跳焦點。原有純文字報告、單按鈕收據分享、遮蓋、草稿與本機歷史保留。

手機驗收及相容性限制見 [MOBILE_TEST.md](MOBILE_TEST.md)。`i18n.js` 和 `theme.css` 是必要部署檔案，需與主頁一起保留。鍵盤避讓的最終效果請使用真實手機測試。

# 分帳管家 AI · Bill Splitter AI

用 AI 讀單據、朋友自助認帳，自動計出每人應付幾錢。
主程式及計算在瀏覽器內運作，本機草稿留在自己的裝置；朋友認帳自動回傳和可分享的詳細結果使用專用 Cloudflare Worker/KV 暫存，並按連結期限自動到期。

已加入 **PWA 支援**：可以「加入主畫面」當 App 用，離線都開得。

---

## 檔案結構

```
bill-splitter-ai/
├── index.html                  ← 主程式（OCR 前遮蓋敏感資料；核對與分帳計算維持原流程）
├── claim.html                  ← 手機認帳頁（朋友可一按「交返發起人」；WhatsApp 只作後備）
├── claim-relay.js              ← 加密認帳轉送（免費 ntfy.sh，唔使帳號）
├── i18n.js                     ← 中英文介面詞典
├── theme.css                   ← 灰階與綠色漸變主題
├── manifest.webmanifest        ← PWA 設定（App 名、顏色、圖示）
├── sw.js                       ← Service worker（離線快取）
├── pwa.js                      ← 安裝提示 + 更新提示
├── .nojekyll                  ← 叫 GitHub Pages 唔好用 Jekyll 處理
├── README.md
├── MOBILE_TEST.md             ← 本機手機測試步驟
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
| 產生認帳連結／複製分帳結果 | ✅ 可以 |
| **AI 讀單據（拍照識別）** | ❌ 需要網絡（要呼叫 AI 服務） |

App 本身偵測到離線會自動提示你改用手動輸入。

---

## 改完 index.html 之後（重要）

Service worker 會快取舊版本。你更新完 `index.html` 或 `claim.html`，請同時開 `sw.js`，
將 `CACHE_VERSION` 的版本號加一：

```js
const CACHE_VERSION = 'v37';  // 下一次改成 'v38'，之後依序遞增
```

咁舊用戶下次開就會收到「🔄 有新版本可用」提示，按「更新」即可。
唔改版本號的話，已安裝嘅用戶可能會繼續睇到舊版。

---

## 關於私隱

- 冇後端、冇伺服器，你嘅單據同金額**唔會**傳去我哋任何地方。
- 歷史紀錄存在瀏覽器 `localStorage`，只在你部機。
- 認帳連結會在網址片段中帶有項目編號、中文名稱、已有的單據原文及可用單位資料；瀏覽器不會將網址片段傳送給網站伺服器，但任何收到連結的人都能看見這些項目。原文直接取自已保存的 OCR `original`，沒有原文時不猜譯。
- 認帳邀請先分享一個包含全部合併項目的連結，再由用家獨立按鈕分享整批附件；附件分享不帶連結文字或標題，避免 WhatsApp 在每張圖片重複附同一連結。
- 朋友按「交返發起人」後，認帳會先加密，再送到免費公開轉送 [ntfy.sh](https://ntfy.sh)（唔使註冊、唔使 API 鎖匙、唔使付費）。網址片段入面先有房號同解鎖匙，GitHub Pages 睇唔到；ntfy 只保存密文，約 12 小時。發起人嘅分帳頁開住會自動接收，收埋之後再打開或按「重新接收」都會再檢查。收到之後只寫入呢部機嘅草稿。同一位朋友再交會取代舊認帳，幾位朋友可以各自交。
- WhatsApp「分享回覆」同「複製回覆文字」仍然可用，只係後備。舊認帳連結冇房號，要重新分享先用到一按交返。
- 你嘅 AI API key 只存在你部機；`sw.js` 已明確設定**永不快取**
  `openrouter.ai` 同 `ntfy.sh` 嘅請求。
- 上傳嘅單據圖片只會直接傳到 OpenRouter 作 OCR 分析。

⚠️ 提醒：如果你 fork 或公開個 repo，記住**唔好**將 API key 寫死在 code 入面。
呢個 App 設計上係要用戶自己輸入 key，key 只留在瀏覽器。

---

## Icon 設計

三色配搭，白色收據放在綠色漸變底上：

| 部件 | 顏色 | 色碼 |
|---|---|---|
| 背景漸變 | 綠（跟 App 主色） | `#22C55E` → `#117A3A` |
| 收據標題條 | 金黃 | `#F59E0B` |
| 勾號 | 藍 | `#2563EB` |
| 收據紙 / 徽章底 | 白 | `#FFFFFF` |
| 內文線條 | 淺灰綠 | `#C6D5CD` |

16px 細尺寸會自動簡化內部線條（隱藏三條內文線、放大標題條），
確保 favicon 都睇得清。

### 想改色？

改 `icons/icon.svg` 最方便，佢係向量檔，用文字編輯器開就見到色碼。
但要注意 **PNG 檔唔會自動跟住變** — PNG 係另外生成嘅。
如果你想整套重新生成，最簡單係話我知你要咩色，我幫你重出一套齊全嘅。

---

## License

MIT — 見 `LICENSE`。

---

<!-- project-status-and-license-notice -->
## 專案狀態與授權

本專案由個人維護，主要用於個人實驗、學習與測試。部分版本可能公開展示或部署供體驗，但功能、資料及部署可能不完整或變更；請在實際依賴前自行核實，不構成任何第三方背書。

原始程式碼依照本倉庫 [`LICENSE`](LICENSE) 所列的 MIT License 授權。作者請求不要將本專案未修改的完整副本公開再發佈或鏡像，亦不要冒稱原創；這是請求而非額外限制，複製、修改及再發佈權利仍以該授權條款為準，並須保留其中要求的聲明。第三方程式、資料、圖片、商標及來源材料不受此說明取代，請遵守其各自的授權與條款。
## v113：活動名稱確認後前往分享

第二步「活動名稱／連結有效期」卡右下角新增「確定」按鈕；按下會平滑捲動至「分享認帳連結及附件」，不會建立連結或鎖定名稱，分享前仍可返回修改。主程式按鈕提示字移除投影，黑色文字維持無文字陰影。主程式 `R113`，PWA 快取 `v113-activity-confirm-scroll`。

## R132：精確恢復 R128 前介面
依 Git 基準提交 `82b7f89` 還原 `index.html` 與 `theme.css`，恢復四步進度列、原本第一步辨識／Key／其他 AI 翻譯版面，以及第二步活動、商品和分享區的順序；保留 R127 當時既有面板狀態，不套用 R128–R131 的手機重新排列、R131 持久收合偏好或一律強制展開。保留 R129 同一認帳連結重算同步、朋友頁 revision 更新和 Worker／Durable Object 儲存行為。主程式版號及 PWA／朋友頁快取標記升至 R132。
