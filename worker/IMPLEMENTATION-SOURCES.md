# 同一分享連結實作依據

- Cloudflare Worker Script Upload API（ES modules 用 multipart/form-data，metadata 指定 main_module；可更新現有 Worker）：https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
- Cloudflare multipart upload metadata（main_module、bindings、compatibility_date 格式）：https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- Cloudflare Workers KV 寫入（put 可更新現有 key；expirationTtl 最少 60 秒；同一 key 每秒最多一次寫入；跨區讀取可能延遲最多 60 秒）：https://developers.cloudflare.com/kv/api/write-key-value-pairs/
- Cloudflare KV 限額（免費額度 reads 100,000/day、寫不同 keys 1,000/day、同一 key 1 write/sec、value 25 MiB）：https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare Durable Objects SQLite storage（強一致、具交易性）：https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare Durable Objects limits（SQLite 每個 key/value 合計最多 8 MB；單一 string/BLOB/row 最多 8 MB）：https://developers.cloudflare.com/durable-objects/platform/limits/

實作決策：使用既有 Worker/KV 建立預待結算 session，回覆既有認帳 short URL 指向該 session；主辦人仍以獨立隨機 write token PUT。朋友拿到的是 bearer URL，主辦人 write token 只存於建立該活動的裝置草稿，不放入朋友 URL。認帳活動最新結算結果及單調遞增 revision 改存同一活動既有的 SQLite Durable Object，並以 512 KiB chunks 避免單一值超過 8 MiB 限制；KV 保留相容鏡像與 session/expiry 索引。朋友頁以 `?meta=1` 輕量查 revision，變更時才重新讀取完整結果。普通結果分享仍使用 KV。
