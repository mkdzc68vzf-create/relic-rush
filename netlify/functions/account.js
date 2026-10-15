const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { getStore } = require("@netlify/blobs");
const scrypt = promisify(crypto.scrypt);

const COOKIE = "rr_player_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 180 * 1024;
const RELICS = new Set(["forest", "stone", "moon", "frost", "dragon", "phantom", "solar", "void"]);
const WEAPONS = new Set(["iron", "steel", "plasma"]);

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}
function b64url(input) { return Buffer.from(input).toString("base64url"); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token, secret) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split("."); if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest("base64url");
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload || payload.role !== "player" || typeof payload.username !== "string" || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
function cookieValue(event, name) {
  const raw = event.headers.cookie || event.headers.Cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
function cookieHeader(token, maxAge = SESSION_TTL_SECONDS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function originAllowed(event) {
  const allowed = process.env.URL || "";
  const origin = event.headers.origin || event.headers.Origin;
  if (!allowed || !origin) return true;
  try { return new URL(origin).host === new URL(allowed).host; } catch { return false; }
}
function integer(v, min, max, fallback = min) {
  return Number.isSafeInteger(v) && v >= min && v <= max ? v : fallback;
}
function cleanItem(item) {
  if (!item || typeof item !== "object" || !RELICS.has(item.id)) return null;
  return {
    uid: typeof item.uid === "string" ? item.uid.slice(0, 100) : crypto.randomBytes(8).toString("hex"),
    id: item.id,
    gold: item.gold === true
  };
}
function sanitizeSave(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  let serialized;
  try { serialized = JSON.stringify(input); } catch { return null; }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 150 * 1024) return null;
  const inventory = Array.isArray(input.inventory) ? input.inventory.slice(0, 3000).map(cleanItem).filter(Boolean) : [];
  const weapons = Array.isArray(input.weapons) ? [...new Set(input.weapons.filter(w => WEAPONS.has(w)))].slice(0, 3) : ["iron"];
  if (!weapons.includes("iron")) weapons.unshift("iron");
  const equipped = WEAPONS.has(input.equipped) && weapons.includes(input.equipped) ? input.equipped : "iron";
  const listings = Array.isArray(input.listings) ? input.listings.slice(0, 500).map(l => {
    const item = cleanItem(l && l.item);
    if (!item) return null;
    return { id: integer(l.id, 1, 1000000000, 1), item, price: integer(l.price, 1, 1000000000, 1) };
  }).filter(Boolean) : [];
  const runs = Array.isArray(input.runs) ? input.runs.slice(0, 20).map(r => ({
    wave: integer(r && r.wave, 1, 1000000, 1),
    kills: integer(r && r.kills, 0, 1000000000, 0),
    coins: integer(r && r.coins, 0, 1000000000, 0),
    date: typeof (r && r.date) === "string" ? r.date.slice(0, 40) : ""
  })) : [];
  const achievements = Array.isArray(input.achievements) ? [...new Set(input.achievements.filter(x => typeof x === "string" && /^[a-z0-9_-]{1,60}$/i.test(x)))].slice(0, 200) : [];
  return {
    coins: integer(input.coins, 0, 1000000000, 100),
    health: integer(input.health, 0, 100, 100),
    wave: integer(input.wave, 1, 1000000, 1),
    bestWave: integer(input.bestWave, 1, 1000000, 1),
    kills: integer(input.kills, 0, 1000000000, 0),
    totalCoins: integer(input.totalCoins, 0, 1000000000, 0),
    packsOpened: integer(input.packsOpened, 0, 1000000000, 0),
    inventory, weapons, equipped, listings, runs, achievements,
    lastDaily: typeof input.lastDaily === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.lastDaily) ? input.lastDaily : "",
    marketId: integer(input.marketId, 1, 1000000000, 1)
  };
}
function defaultSave() {
  return { coins: 100, health: 100, wave: 1, bestWave: 1, kills: 0, totalCoins: 0, packsOpened: 0, inventory: [], weapons: ["iron"], equipped: "iron", listings: [], runs: [], achievements: [], lastDaily: "", marketId: 1 };
}
async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString("hex");
}
function validUsername(raw) {
  if (typeof raw !== "string") return null;
  const username = raw.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return null;
  return { display: username, key: username.toLowerCase() };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) return json(413, { error: "Request is too large." });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed." });

  const sessionSecret = process.env.RELIC_RUSH_SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) return json(500, { error: "Player accounts are not configured. Set RELIC_RUSH_SESSION_SECRET in Netlify environment variables." });
  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: "Invalid JSON." }); }
  const store = getStore("relic-rush-player-data");

  try {
    if (body.action === "register") {
      const user = validUsername(body.username);
      if (!user) return json(400, { error: "Username must be 3–20 letters, numbers, or underscores." });
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) return json(400, { error: "Password must be 8–128 characters." });
      const initialSave = sanitizeSave(body.save);
      if (!initialSave) return json(400, { error: "Could not read your current game save. Refresh and try again." });
      const userKey = `user:${user.key}`;
      const existing = await store.get(userKey, { type: "json" });
      if (existing) return json(409, { error: "That username is already taken. Try logging in instead." });
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = await hashPassword(body.password, salt);
      await store.setJSON(userKey, { username: user.display, salt, passwordHash, createdAt: new Date().toISOString() });
      await store.setJSON(`save:${user.key}`, initialSave);
      const now = Math.floor(Date.now() / 1000);
      const token = sign({ role: "player", username: user.key, iat: now, exp: now + SESSION_TTL_SECONDS, nonce: crypto.randomBytes(12).toString("hex") }, sessionSecret);
      return json(201, { ok: true, username: user.display, save: initialSave }, { "Set-Cookie": cookieHeader(token) });
    }

    if (body.action === "login") {
      const user = validUsername(body.username);
      if (!user || typeof body.password !== "string" || body.password.length > 128) return json(401, { error: "Incorrect username or password." });
      const record = await store.get(`user:${user.key}`, { type: "json" });
      if (!record || typeof record.salt !== "string" || typeof record.passwordHash !== "string") return json(401, { error: "Incorrect username or password." });
      const candidate = await hashPassword(body.password, record.salt);
      if (!safeEqual(candidate, record.passwordHash)) return json(401, { error: "Incorrect username or password." });
      const saved = await store.get(`save:${user.key}`, { type: "json" });
      const now = Math.floor(Date.now() / 1000);
      const token = sign({ role: "player", username: user.key, iat: now, exp: now + SESSION_TTL_SECONDS, nonce: crypto.randomBytes(12).toString("hex") }, sessionSecret);
      return json(200, { ok: true, username: record.username, save: saved ? sanitizeSave(saved) : null }, { "Set-Cookie": cookieHeader(token) });
    }

    if (body.action === "logout") return json(200, { ok: true }, { "Set-Cookie": cookieHeader("", 0) });

    const token = cookieValue(event, COOKIE);
    const session = verify(token, sessionSecret);
    if (!session) return json(401, { error: "Please log in to your player account again." });
    const userRecord = await store.get(`user:${session.username}`, { type: "json" });
    if (!userRecord) return json(401, { error: "Player account not found. Please log in again." });

    if (body.action === "me") {
      const saved = await store.get(`save:${session.username}`, { type: "json" });
      return json(200, { ok: true, username: userRecord.username, save: saved ? sanitizeSave(saved) : null });
    }
    if (body.action === "save") {
      const clean = sanitizeSave(body.save);
      if (!clean) return json(400, { error: "Save data is invalid or too large." });
      await store.setJSON(`save:${session.username}`, clean);
      return json(200, { ok: true, savedAt: new Date().toISOString() });
    }
    return json(400, { error: "Unknown account action." });
  } catch (err) {
    console.error("Relic Rush account function error", err && err.message);
    return json(500, { error: "Account service failed. Check the Netlify function logs and Blobs setup." });
  }
};
