# 個人認帳資料流與所有權設計

目前朋友認帳由 Cloudflare Worker 驗證，活動認帳資料及最新結果留在每活動 SQLite Durable Object；Workers KV 保存活動索引與相容鏡像。朋友結果連結仍是持有連結即可讀取的分享頁，不是登入帳戶；只有已驗證的本人憑證或短效編輯票據可以修改該人的認帳。

認帳碼可選填 3 或 4 個非空白可列印 ASCII 字元，大小寫敏感。自設碼以雜湊形式保存在伺服器；舊 R104 密碼紀錄仍可使用。若不設碼，瀏覽器建立隨機 256-bit owner proof，放在獨立 IndexedDB store；Worker 只保存 SHA-256 雜湊，姓名單獨不能取回或修改認帳。朋友換裝置時可以輸入自設碼，或由主辦人用一次性、短期限確認碼授權恢復新裝置。主辦人預置的 reserved 認帳已有原始 claims；首次綁定不論使用 owner proof、3／4 字碼或密碼，都必須先兌換有效的一次性主辦人確認碼，否則拒絕並保留原 claims。owner proof 不放入網址、公開結果、localStorage 或 sessionStorage。

初次認帳和認帳修訂沿用既有認帳項目及結算分配。朋友結果頁的「保存我的本機帳單」只把已選朋友自己的明細和分享收據寫進該瀏覽器 IndexedDB，不呼叫 Worker 寫入，也不改動任何分攤公式。現行產品流程不使用公開 ntfy relay；舊 `claim-relay.js` 僅保留相容資產及獨立歷史測試。

官方技術來源：

- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)：SQLite Durable Objects 的可用方案與配額。
- [Cloudflare SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)：SQLite／KV 儲存、交易及刪除介面。
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)：Worker 支援 SHA-256、HMAC、PBKDF2 及 timing-safe comparison。
- [Cloudflare multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)：保留既有 Worker 設定的多模組部署方式。
