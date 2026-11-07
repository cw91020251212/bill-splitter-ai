# R104 個人認帳密碼保護

同一條活動連結繼續公開讀取結果，個人認帳的建立、解鎖及重新提交改由既有 Cloudflare Worker 驗證。每個活動使用一個 SQLite Durable Object，序列化同名註冊及更新，避免 Workers KV 最終一致性導致先後覆蓋。原 KV 分享結果、網站網址及主辦人發布金鑰保留。

首次新認帳設定至少 8 字密碼；編輯前姓名加密碼核對。密碼、編輯 token 不放入分享 URL、結果 payload 或朋友本機草稿。伺服器儲存隨機 salt 及加密雜湊，另使用 Worker secret pepper，錯誤嘗試限流。舊認帳先預留姓名及既有認帳，只有主辦人發出的單次確認碼可綁定或重設密碼；不容許第一個碰到舊姓名的人搶綁。主辦人只讀取經伺服器驗證的更新；舊 ntfy 輸入不可繞過新版驗證。到期由伺服器拒絕並清理。

官方來源：

- https://developers.cloudflare.com/durable-objects/platform/pricing/ ：SQLite Durable Objects 可使用 Workers Free；免費額度有上限，不更改付費方案。
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ ：SQLite/KV 儲存方法與交易、刪除。
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ ：原生 HMAC、PBKDF2、SHA-256 及 timing-safe comparison 支援。
- https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/ ：保留既有設定的多模組部署及 Durable Object migration/binding。
