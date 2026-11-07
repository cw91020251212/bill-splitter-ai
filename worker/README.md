# Temporary bill-share Worker

This Worker is deployed at `https://bill-splitter-share.cw9102025.workers.dev`. Normalized results and up to five receipt images remain in the original private Workers KV namespace. Ordinary result shares retain the seven-day default TTL. Claim sessions accept 1, 3, 7, or 14 days and use the same result key from pending through ready. Anyone with the friend link can read the result, but R104 requires each person's name and password before changing their claims. API responses are `no-store`, share routes `noindex`, and there is no public bucket or unauthenticated private-claim list endpoint.

The production configuration in `wrangler.toml` binds `BILL_SHARES` to the namespace and limits CORS to `https://cw91020251212.github.io`. The front-end API origin is set in the repository-root `share-config.js`.

## R104 authentication deployment

Deploy all three modules in `src/`, retain the existing KV and variables, add the `CLAIM_AUTH` binding to the exported `ClaimAuth` SQLite Durable Object, and apply migration `v1-claim-auth`. `CLAIM_PASSWORD_PEPPER` is a private Worker secret generated at deployment, not a value committed to this repository. Do not rotate it without a password migration; existing password hashes depend on it. The original account/URLs and billing plan are unchanged. SQLite Durable Objects support Workers Free within its quotas.

Each activity stores serialized name registration and latest verified claims privately in one Durable Object. Passwords are pepper-prehashed with HMAC-SHA256 and salted PBKDF2-SHA256 (100,000 Workers-supported iterations). Edit tickets last at most 15 minutes; organizer confirmation codes at most 10 minutes and one use. Hashes only are stored. Wrong password/code attempts are rate-limited. Expiry is enforced server-side and an alarm deletes authentication data. Public result routes never return passwords, hashes, salts, tickets or confirmation codes.

`/api/shares/{id}/claims/{status,unlock,submit}` provides public status and verified own-name operations. `setup`, `inbox` and `approve` require the existing organizer bearer token. Legacy activities require organizer setup; all unregistered legacy names require a private organizer confirmation code. Existing claims stay intact. The updated main app receives only verified private inbox updates, not ntfy. Protected result PUTs reject stale or unverified claim quantities. The old result-only API remains compatible.

Run `node --test worker/claim-auth.test.mjs worker/worker-core.test.mjs` from the repository root. Local Wrangler also needs a local-only pepper in a private `worker/.dev.vars` file; never copy the production pepper into browser code or source control.

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
