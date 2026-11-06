# 同一分享連結實作依據

- Cloudflare Worker Script Upload API（ES modules 用 multipart/form-data，metadata 指定 main_module；可更新現有 Worker）：https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
- Cloudflare multipart upload metadata（main_module、bindings、compatibility_date 格式）：https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- Cloudflare Workers KV 寫入（put 可更新現有 key；expirationTtl 最少 60 秒；同一 key 每秒最多一次寫入；跨區讀取可能延遲最多 60 秒）：https://developers.cloudflare.com/kv/api/write-key-value-pairs/
- Cloudflare KV 限額（免費額度 reads 100,000/day、寫不同 keys 1,000/day、同一 key 1 write/sec、value 25 MiB）：https://developers.cloudflare.com/kv/platform/limits/

實作決策：使用既有 Worker/KV 建立預待結算 session，回覆既有認帳 short URL 指向該 session；結算資料更新同一 key，以獨立隨機 write token 授權主辦人 PUT。朋友拿到的是 bearer URL，主辦人 write token 只存於建立該活動的裝置草稿，不放入朋友 URL。KV 是 eventually consistent，更新結果可能在全球節點有最多約 60 秒傳播延遲，結果頁應輪詢 pending 狀態並說明稍候重試。
