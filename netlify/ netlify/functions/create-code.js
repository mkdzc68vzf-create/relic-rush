
const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

function reply(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

function verifyToken(token) {
  const secret = process.env.RELIC_RUSH_SESSION_SECRET;
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    );
    return data.sub === "relic-rush-admin" &&
      Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method not allowed." });
  }

  const token = (event.headers.authorization || "")
    .replace(/^Bearer\s+/i, "");

  if (!verifyToken(token)) {
    return reply(401, {
      ok: false,
      error: "Admin session expired. Please log in again."
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { ok: false, error: "Invalid request." });
  }

  const rewardCoins = Number(body.rewardCoins);
  const maxRedemptions = Number(body.maxRedemptions);
  const expiryInput = body.expiryDays;

  const allowedRewards = [100, 500, 1000, 2500, 10000];

  if (!allowedRewards.includes(rewardCoins)) {
    return reply(400, { ok: false, error: "Invalid coin reward." });
  }

  if (
    !Number.isInteger(maxRedemptions) ||
    maxRedemptions < 1 ||
    maxRedemptions > 100000
  ) {
    return reply(400, { ok: false, error: "Invalid use limit." });
  }

  let expiresAt = null;

  if (expiryInput !== "" && expiryInput != null) {
    const days = Number(expiryInput);

    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return reply(400, { ok: false, error: "Invalid expiry." });
    }

    expiresAt = Date.now() + days * 86400000;
  }

  try {
    const store = getStore("relic-rush-codes");
    let code;
    let key;

    // Retry if a randomly generated code already exists.
    for (let attempt = 0; attempt < 5; attempt++) {
      code = "RELIC-" +
        crypto.randomBytes(6).toString("hex").toUpperCase();
      key = `code:${code}`;

      const existing = await store.get(key);
      if (existing === null) break;

      code = null;
    }

    if (!code) {
      return reply(500, { ok: false, error: "Please try again." });
    }

    await store.setJSON(key, {
      code,
      rewardCoins,
      maxRedemptions,
      redemptions: 0,
      createdAt: Date.now(),
      expiresAt
    });

    return reply(200, {
      ok: true,
      code,
      rewardCoins,
      maxRedemptions,
      expiresAt
    });
  } catch (error) {
    console.error("Giveaway creation failed:", error);
    return reply(500, {
      ok: false,
      error: "Could not save the giveaway code."
    });
  }
};
