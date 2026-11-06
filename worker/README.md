# Temporary bill-share Worker

This Worker is deployed at `https://bill-splitter-share.cw9102025.workers.dev` and stores only normalized bill fields and up to five receipt images in the dedicated private Cloudflare Workers KV namespace. Ordinary result shares retain the seven-day default TTL. Claim sessions accept the app's 1, 3, 7, or 14 day choices and use the same KV record from the initial pending state through the final result. API responses are `no-store`, the share routes are marked `noindex`, and there is no list endpoint or public object bucket. A friend URL is a bearer link: anyone who receives it can submit a claim or view the shared result until it expires.

The production configuration in `wrangler.toml` binds `BILL_SHARES` to the namespace and limits CORS to `https://cw91020251212.github.io`. The front-end API origin is set in the repository-root `share-config.js`.

## Local development

From the repository root, run the static app on port 4178 and the Worker on port 8787:

```sh
python3 -m http.server 4178 --bind 127.0.0.1
cd worker
npx wrangler dev --local --persist-to /tmp/bill-splitter-share-kv \
  --var 'SITE_BASE_URL:http://127.0.0.1:4178/' \
  --var 'ALLOWED_ORIGINS:http://127.0.0.1:4178'
```

Wrangler uses local KV emulation for this test. No Cloudflare account or remote KV data is touched. Browser tests can set `window.BillShareConfig.apiBaseUrl` to the local Worker origin.

## Single claim-and-result link

`POST /api/shares/sessions` creates an expiring `pending` record and returns a random 256-bit organizer write token once. The creator keeps that token only in the local draft; it is never put into the friend URL. `PUT /api/shares/{id}` requires the token as a bearer credential and changes the same KV key to `ready` with the normalized final result. `GET /api/shares/{id}` returns `202 pending` before calculation, then the result after publication. The claim page polls this status and shows the detailed result inside the original claim URL when ready. Updating a KV key is rate-limited to one write per second, so the Worker spaces the initial publish after session creation. KV is eventually consistent; the browser may need to wait briefly before every edge can read the update.

The Worker core tests run from the repository root with `node --test worker/worker-core.test.mjs`.

## Data handling limits

Each record is capped at 8 MiB, with a maximum of five JPEG, PNG, or WebP receipt images. The browser compresses images locally when needed, starting at 2,400 px / WebP quality 0.86 and progressively reducing to 1,000 px / quality 0.64; originals are kept when they already fit. If the complete record still exceeds 8 MiB, the app reports the limit and does not upload it. The original receipt images in the creator's local storage are not replaced by the compressed sharing copies.
