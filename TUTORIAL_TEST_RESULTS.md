# 四步互動教學：驗收結果

**最終本機版本全部通過：14 個介面場景、3 個安全／離線場景、11 項原有核心測試。**

## 已完成

右上角「教學」開啟高亮導覽，依次示範上載睇單、各自認帳、分帳運算及最終結果。第 2 步會自動打開項目編輯、分享面板及朋友認帳欄，共 6 個教學畫面；可用上一／下一步、直接按 1–4 跳轉、完成、× 或 Escape 離開。「詳細說明」保留原本的文字教學。

教學使用獨立的唯讀示範 App，原 App 不卸載。示例由原本分帳核心運算：$120 食物加 $12 服務費，按 2：1 分，阿明 $88、Cathy $44。

## 實際通過的檢查

- 香港繁體中文及英文，各測 320×640、390×844、768×1024、1280×800、844×390，共 10 個完整教學流程。
- 原本停在第 1、2、3、4 步，分別測試中途退出、上一頁及重新開啟，共 4 個還原場景。
- 比較教學前後的欄位值、勾選、展開狀態及原有 DOM。僅忽略瀏覽器加入的空白 `style=""`，不忽略欄位或樣式內容。
- 比較 localStorage 及 IndexedDB 的原有帳單、歷史、圖片與附件，全部保持不變；原本捲動位置及焦點亦有還原。
- 教學期間記錄 Storage／IndexedDB 的寫入呼叫，結果為零；亦沒有 OpenRouter／ntfy 請求。
- 空白帳單、Tab 焦點循環、四步跳轉、視窗旋轉尺寸、程式化點擊敏感操作的安全防護，以及原有詳細教學返回。
- 已註冊 Service Worker 的環境：先載入依賴，再離線重開並完成教學。刻意刪除教學 runtime cache 後，帶版本參數的腳本／樣式仍能由 canonical precache 後備取得。
- 原有 OCR cascade 與認帳核心測試 11 項通過，包括公開 ntfy.sh 的雙客戶端轉送整合測試。
- `tutorial.js`、`sw.js` 及兩份測試腳本的 JavaScript 語法檢查、`git diff --check` 通過。

## 尚未驗收的界線

瀏覽器驗收使用本機 Chromium，並非真實 iPhone Safari／Android WebView，也沒有實測手機軟鍵盤、相機、系統分享或真實 API 鎖匙的 OCR。這些正式功能沒有被刪除；教學內則刻意禁止觸發。發布後仍應在目標手機作簡短實機檢查。

本次沒有推送 GitHub、修改 Pages 設定或發布公開網站。發布目的地應維持 **cw91020251212/bill-splitter-ai**；參考的 Pure-reader-hk 不是發布目的地。

## 重跑

見 [tests/README.md](tests/README.md)。本機靜態伺服器啟動後執行：

```sh
node tests/tutorial-ui.cjs
node tests/tutorial-safety.cjs
node --test ocr-cascade.test.cjs claim-relay.test.cjs
```

原始結果 JSON 及 390px 教學截圖存於共享工作區 `/workspace/bill-tutorial-qa/`。終端輸出為 `/workspace/bill-tutorial-qa-final.log`、`/workspace/bill-tutorial-safety-final.log`、`/workspace/bill-tutorial-core-final.log`。
