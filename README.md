# Relic Rush — Player Accounts + Streamer Admin

This package keeps the existing Relic Rush game and adds server-backed player accounts.

## Files and exact locations

- `index.html` — existing game UI and gameplay, player account panel, cloud-save sync, streamer admin panel, reward-code redemption UI.
- `netlify.toml` — publishes the repository root and points Netlify at `netlify/functions`.
- `package.json` — installs `@netlify/blobs`.
- `netlify/functions/admin.js` — server-verified streamer secret-code login, signed short-lived admin session, validated admin commands, giveaway code creation.
- `netlify/functions/account.js` — player registration/login/logout, password hashing with scrypt, HttpOnly player session cookie, server-stored save.
- `netlify/functions/redeem.js` — requires a signed-in player and applies a one-time giveaway reward to the player's server save.

## Netlify environment variables

Set both under **Production**, with **Functions** scope if available, and mark them secret:

- `RELIC_RUSH_ADMIN_CODE`: your streamer/admin login code, at least 8 characters.
- `RELIC_RUSH_SESSION_SECRET`: a random secret of at least 32 characters. It signs admin and player sessions; don't use your admin code for this.

Redeploy after changing environment variables or function code.

## Deploy from GitHub

The repository root must contain `index.html`, `netlify.toml`, and `package.json`. The folder layout must be:

```
netlify/
  functions/
    admin.js
    account.js
    redeem.js
```

Netlify should list `admin`, `account`, and `redeem` under Functions after a successful production deploy.

## Player accounts

- Usernames: 3–20 letters, numbers, or underscores; usernames are case-insensitive.
- Passwords: 8–128 characters; passwords are hashed server-side with Node's scrypt. The raw password is not stored.
- Player sessions use an HttpOnly, Secure, SameSite=Strict cookie and expire after seven days.
- Creating an account copies the current browser's `relicRushSave` to the new account, preserving local progress.
- Logging in loads the server-stored save; future game saves sync to Netlify Blobs.
- Giveaway redemption requires a logged-in player and updates the server save.
- There is no email-based password recovery yet. Players should use a unique password and keep it somewhere safe.

## Important limitations

Netlify Blobs stores account and save records, but it is not a transactional database. This is suitable for a small project, not a high-traffic competitive economy. Username creation and one-time reward claims can have race conditions under simultaneous requests; use a transactional database for larger launches.

The account login and password storage are server-side, but the game still sends save data from the browser. A determined player can modify local gameplay values before syncing. Preventing currency/relic cheating requires moving purchases, pack rolls, combat rewards, and other economy-changing actions to server-authoritative functions.

The local marketplace remains a local demo, not a marketplace shared among players. Existing local progress stays in the browser when logged out. Registering transfers a copy to the new account; signing into an existing account replaces the current in-memory save with that account's server save.
