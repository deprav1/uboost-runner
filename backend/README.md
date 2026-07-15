# Global dashboard and leaderboard

The game remains a static GitHub Pages site. This folder is a separate Cloudflare
Worker with D1 storage: it provides the only required mutable part — anonymous
event aggregates and one best score per anonymous browser installation.

## Deploy

1. Create a Cloudflare D1 database and KV namespace.
2. Copy `wrangler.toml.example` to `wrangler.toml` and fill the two IDs.
3. Run `wrangler d1 execute uboost-runner --file=schema.sql --remote`.
   For an existing database created before Telegram prizes, run
   `wrangler d1 execute uboost-runner --file=migrations/002_add_telegram_id.sql --remote`
   and then `wrangler d1 execute uboost-runner --file=migrations/003_add_analytics_telegram_id.sql --remote`.
4. Run `wrangler secret put BOT_TOKEN` and enter the token of the Telegram bot
   that opens this Mini App. The token is never committed or delivered to the browser.
5. Run `wrangler deploy` from this directory.
5. Put the deployed URL into the game config:

```js
ANALYTICS_ENDPOINT: 'https://YOUR-WORKER.workers.dev/v1/events',
DASHBOARD_ENDPOINT: 'https://YOUR-WORKER.workers.dev/v1/dashboard',
LEADERBOARD_ENDPOINT: 'https://YOUR-WORKER.workers.dev',
```

Keep `ALLOWED_ORIGIN` limited to the published game origin. Analytics accepts no
IP addresses, names, email addresses or phone numbers. In Telegram, the browser
sends signed `initData` separately from each event; the Worker validates it with
`BOT_TOKEN`, stores only the resulting `telegram_id`, and immediately discards
the signed payload. This makes it possible to find the recipient of a prize from
the verified game-over/CTA events without treating `initDataUnsafe` as trusted.
The public alias is derived from the final four digits of that ID.

Before publishing, add a privacy notice and retention period for `telegram_id`.
The game already shows a concise notice inside Telegram; the policy should name
the prize organiser, purpose, storage duration and contact for deletion.

Telegram identity is authenticated, but scores are still client-submitted and
rate-limited. Do **not** grant a prize solely for a score until a server-side
run-verification protocol is added; otherwise a valid Telegram user can forge a
high score. The current setup is safe for identifying a recipient after a
separate, verified selection process.
