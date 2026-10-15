# Relic Rush Streamer Admin + Giveaway Codes

This package extends the existing Relic Rush browser game with a server-verified admin login and one-time giveaway-code flow.

## Files
- `index.html`: existing Relic Rush game, existing `localStorage` save key (`relicRushSave`), admin panel, and viewer code redemption.
- `netlify/functions/admin.js`: existing signed admin session plus secure reward-code creation.
- `netlify/functions/redeem.js`: server-checked redemption.
- `netlify.toml`: Netlify Functions configuration.
- `package.json`: Netlify Blobs dependency.

## Add to your GitHub repository
1. Make a backup branch or copy of the current repo first.
2. Replace the repository's current `index.html` with this `index.html`.
3. Add/replace `netlify.toml` and `package.json` at the repository root.
4. Add `netlify/functions/admin.js` and `netlify/functions/redeem.js`.
5. Commit and push. Netlify should build a new deploy from GitHub.

## Netlify environment variables
In Netlify: **Site configuration → Environment variables**, add:
- `RELIC_RUSH_ADMIN_CODE`: a private password/code at least 8 characters long.
- `RELIC_RUSH_SESSION_SECRET`: a different random secret, at least 32 characters long.

Generate a session secret with `openssl rand -hex 32` if you have a terminal. Do not put either secret in GitHub or in `index.html`. Redeploy after setting them.

## Use it on stream
1. Open the deployed site and click **Admin Login**.
2. Enter your `RELIC_RUSH_ADMIN_CODE`.
3. In the admin panel, create a coin or relic reward code.
4. Show the generated code on stream.
5. Viewers enter it in **Stream Giveaway Code** on the home screen.

## Important limitations
- The game still stores each player's save in that player's browser under `localStorage` key `relicRushSave`. A redeemed reward changes only that browser's save. There are no player accounts or cross-device sync.
- The admin password is checked by the Netlify Function, and the signed admin session expires after 10 minutes.
- Netlify Blobs stores the reward codes and redemption state. This implementation blocks ordinary repeat redemptions, but simultaneous requests can race because Blobs is not a transactional database. If you plan high-value or high-traffic giveaways, use a database with atomic claims (for example, a PostgreSQL table with an `UPDATE ... WHERE redeemed_at IS NULL RETURNING ...` transaction).
- Since saves remain client-side, this is not a cheat-proof online economy. Players can modify their own local save. The server only controls issuance and redemption of codes.
