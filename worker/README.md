# Temporary bill-share Worker

This Worker is deployed at `https://bill-splitter-share.cw9102025.workers.dev`. Ordinary result-only shares and claim-session metadata use the original private Workers KV namespace. Claim sessions also store their canonical latest result in the existing per-session SQLite Durable Object so recalculated results are immediately consistent. Up to five receipt images remain in the shared result payload. Ordinary result shares retain the seven-day default TTL. Claim sessions accept 1, 3, 7, or 14 days and keep the same friend URL from pending through ready and later recalculations. Anyone with the friend link can read the result. R116 supports an optional, case-sensitive four-character printable ASCII recognition code (letters, digits, and non-space printable symbols): a saved code is required for that name's edits, but a name with no code can be retrieved and edited by name alone. This is deliberately lightweight identification, not strong identity assurance. API responses are `no-store`, share routes `noindex`, and there is no public bucket or unauthenticated bulk private-claim list endpoint.

The production configuration in `wrangler.toml` binds `BILL_SHARES` to the namespace and limits CORS to `https://cw91020251212.github.io`. The front-end API origin is set in the repository-root `share-config.js`.

## R104 authentication deployment

Deploy all three modules in `src/`, retain the existing KV and variables, add the `CLAIM_AUTH` binding to the exported `ClaimAuth` SQLite Durable Object, and apply migration `v1-claim-auth`. `CLAIM_PASSWORD_PEPPER` is a private Worker secret generated at deployment, not a value committed to this repository. Do not rotate it without a password migration; existing password hashes depend on it. The original account/URLs and billing plan are unchanged. SQLite Durable Objects support Workers Free within its quotas.

Each activity stores serialized name registration and latest verified claims privately in one Durable Object. Passwords are pepper-prehashed with HMAC-SHA256 and salted PBKDF2-SHA256 (100,000 Workers-supported iterations). Edit tickets last at most 15 minutes; organizer confirmation codes at most 10 minutes and one use. Hashes only are stored. Wrong password/code attempts are rate-limited. Expiry is enforced server-side and an alarm deletes authentication data. Public result routes never return passwords, hashes, salts, tickets or confirmation codes.

`/api/shares/{id}/claims/{status,unlock,submit}` provides status and individual name operations. R116 requests use `recognitionCode` (empty or exactly four non-space printable ASCII characters; case-sensitive); existing numeric codes and old `password` requests/hashes remain compatible. Codes are stored hashed, never returned. `credentialKind` describes none/pin/password/reserved/new without exposing a credential. The internal `claimSecurity: 'password'` flag stays for deployed-client compatibility; it does not imply every member has a password. Unregistered names and old reserved claims no longer require organizer confirmation in the requested lightweight mode. Existing protected PIN/password records are never unlocked by an empty code. `setup`, `inbox` and `approve` still require the original organizer bearer token, and reset codes remain a private optional recovery route. Existing claims stay intact. The main app receives current individual updates through the private inbox, not ntfy; result PUTs reject stale quantities. The old result-only API remains compatible.

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

`POST /api/shares/sessions` creates an expiring `pending` KV record and returns a random 256-bit organizer write token once. The creator keeps that token only in the local draft; it is never put into the friend URL. `PUT /api/shares/{id}` requires the token as a bearer credential, validates current claims, and commits the normalized result with a monotonically increasing revision to that session's existing SQLite Durable Object. The result is stored in 512 KiB chunks to stay below the Durable Object per-value limit. KV remains a compatibility mirror and session/expiry index; it is not authoritative for claim-session result reads.

`GET /api/shares/{id}` returns `202 pending` before calculation, then the canonical Durable Object result after publication. `GET /api/shares/{id}?meta=1` returns only the small status/revision metadata used by an already-open friend page. The page polls every six seconds while open and reloads its embedded detailed view only when the revision advances, preserving the original URL and never replacing an unsent edit. This bypasses KV's cross-location eventual-consistency delay for recalculated results; legacy result-only shares continue to read from KV.

The Worker core tests run from the repository root with `node --test worker/worker-core.test.mjs`.

## Data handling limits

Each record is capped at 8 MiB, with a maximum of five JPEG, PNG, or WebP receipt images. The browser compresses images locally when needed, starting at 2,400 px / WebP quality 0.86 and progressively reducing to 1,000 px / quality 0.64; originals are kept when they already fit. If the complete record still exceeds 8 MiB, the app reports the limit and does not upload it. The original receipt images in the creator's local storage are not replaced by the compressed sharing copies.
