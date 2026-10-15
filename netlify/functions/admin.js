const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = process.env.URL || "";
const SESSION_TTL_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 4096;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin"
    },
    body: JSON.stringify(body)
  };
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest("base64url");
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload || payload.role !== "admin" || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function validInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return json(413, { error: "Request is too large." });
  }

  // Same-origin browser requests are expected. This is defense in depth, not a substitute for auth.
  const origin = event.headers.origin || event.headers.Origin;
  if (ALLOWED_ORIGIN && origin) {
    try {
      if (new URL(origin).host !== new URL(ALLOWED_ORIGIN).host) return json(403, { error: "Origin not allowed." });
    } catch {
      return json(403, { error: "Invalid origin." });
    }
  }

  const adminCode = process.env.RELIC_RUSH_ADMIN_CODE;
  const sessionSecret = process.env.RELIC_RUSH_SESSION_SECRET;
  if (!adminCode || adminCode.length < 8 || !sessionSecret || sessionSecret.length < 32) {
    return json(500, { error: "Admin is not configured. Set RELIC_RUSH_ADMIN_CODE and RELIC_RUSH_SESSION_SECRET in Netlify environment variables." });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return json(400, { error: "Invalid JSON." }); }

  if (body.action === "login") {
    if (typeof body.code !== "string" || body.code.length > 256 || !safeEqual(body.code, adminCode)) {
      // Avoid telling a caller whether the code or configuration is the issue.
      return json(401, { error: "Incorrect developer code." });
    }
    const now = Math.floor(Date.now() / 1000);
    const token = sign({ role: "admin", iat: now, exp: now + SESSION_TTL_SECONDS, nonce: crypto.randomBytes(12).toString("hex") }, sessionSecret);
    return json(200, { token, expiresAt: (now + SESSION_TTL_SECONDS) * 1000 });
  }

  const session = verify(body.token, sessionSecret);
  if (!session) return json(401, { error: "Admin session token is invalid or expired. Log in again." });

  // Only allow specific, validated commands. Do not accept arbitrary JS or arbitrary save objects.
  let command;
  switch (body.action) {
    case "giveCoins":
      if (!validInteger(body.amount, 1, 1000000)) return json(400, { error: "Coin amount must be an integer from 1 to 1,000,000." });
      command = { action: "giveCoins", amount: body.amount, message: `give ${body.amount} coins` };
      break;
    case "setCoins":
      if (!validInteger(body.amount, 0, 10000000)) return json(400, { error: "Coin balance must be an integer from 0 to 10,000,000." });
      command = { action: "setCoins", amount: body.amount, message: `set coin balance to ${body.amount}` };
      break;
    case "giveRelic": {
      const allowedRelics = new Set(["forest", "stone", "moon", "frost", "dragon", "phantom", "solar", "void"]);
      if (typeof body.relicId !== "string" || !allowedRelics.has(body.relicId) || typeof body.gold !== "boolean") {
        return json(400, { error: "Invalid relic selection." });
      }
      command = { action: "giveRelic", relicId: body.relicId, gold: body.gold, message: `grant ${body.gold ? "Gold " : ""}${body.relicId} relic` };
      break;
    }
    case "heal":
      command = { action: "heal", message: "restore health to 100" };
      break;
    case "createRewardCode": {
      const reward = body.reward;
      if (!reward || typeof reward !== "object") return json(400, { error: "Missing reward details." });
      let cleanReward;
      let rewardLabel;
      if (reward.type === "coins" && validInteger(reward.amount, 1, 1000000)) {
        cleanReward = { type: "coins", amount: reward.amount };
        rewardLabel = `${reward.amount} coins`;
      } else if (reward.type === "relic") {
        const allowedRelics = new Set(["forest", "stone", "moon", "frost", "dragon", "phantom", "solar", "void"]);
        if (typeof reward.relicId !== "string" || !allowedRelics.has(reward.relicId) || typeof reward.gold !== "boolean") {
          return json(400, { error: "Invalid relic reward." });
        }
        cleanReward = { type: "relic", relicId: reward.relicId, gold: reward.gold };
        rewardLabel = `${reward.gold ? "Gold " : ""}${reward.relicId} relic`;
      } else {
        return json(400, { error: "Choose a valid coin amount or relic reward." });
      }
      const code = "RR-" + crypto.randomBytes(5).toString("hex").toUpperCase();
      const store = getStore("relic-rush-reward-codes");
      await store.setJSON(code, { reward: cleanReward, createdAt: new Date().toISOString(), redeemed: false });
      return json(200, { code, rewardLabel });
    }
    default:
      return json(400, { error: "Unknown admin command." });
  }

  return json(200, { command });
};
