
const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = process.env.URL || "";
const SESSION_TTL_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 4096;
const codes = getStore("relic-rush-giveaway-codes");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret)
    .update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verify(token, secret) {
  if (typeof token !== "string" || token.length > 2048) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const expected = crypto.createHmac("sha256", secret)
    .update(parts[0]).digest("base64url");

  if (!safeEqual(parts[1], expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );

    if (
      payload.role !== "admin" ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) return null;

    return payload;
  } catch {
    return null;
  }
}

function validInt(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return json(413, { error: "Request is too large." });
  }

  const origin = event.headers?.origin || event.headers?.Origin;
  if (ALLOWED_ORIGIN && origin) {
    try {
      if (new URL(origin).host !== new URL(ALLOWED_ORIGIN).host) {
        return json(403, { error: "Origin not allowed." });
      }
    } catch {
      return json(403, { error: "Invalid origin." });
    }
  }

  const adminCode = process.env.RELIC_RUSH_ADMIN_CODE;
  const sessionSecret = process.env.RELIC_RUSH_SESSION_SECRET;

  if (
    !adminCode || adminCode.length < 8 ||
    !sessionSecret || sessionSecret.length < 32
  ) {
    return json(500, { error: "Admin environment variables are not configured." });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid JSON." });
  }

  // Login: the password is checked only on the server.
  if (body.action === "login") {
    if (typeof body.code !== "string" || !safeEqual(body.code, adminCode)) {
      return json(401, { error: "Incorrect admin password." });
    }

    const now = Math.floor(Date.now() / 1000);
    const token = sign({
      role: "admin",
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
      nonce: crypto.randomBytes(16).toString("hex")
    }, sessionSecret);

    return json(200, {
      token,
      expiresAt: (now + SESSION_TTL_SECONDS) * 1000
    });
  }

  // Every action below requires a valid server-signed session.
  if (!verify(body.token, sessionSecret)) {
    return json(401, { error: "Admin session expired. Log in again." });
  }

  switch (body.action) {
    case "giveCoins":
      if (!validInt(body.amount, 1, 1000000)) {
        return json(400, { error: "Coins must be from 1 to 1,000,000." });
      }
      return json(200, {
        command: { action: "giveCoins", amount: body.amount }
      });

    case "setCoins":
      if (!validInt(body.amount, 0, 10000000)) {
        return json(400, { error: "Balance must be from 0 to 10,000,000." });
      }
      return json(200, {
        command: { action: "setCoins", amount: body.amount }
      });

    case "giveRelic": {
      const validRelic = /^r(?:[0-9]|1[0-9]|2[0-3])$/.test(body.relicId || "");
      const validVariant = ["normal", "gold", "candy"].includes(body.variant);

      if (!validRelic || !validVariant) {
        return json(400, { error: "Invalid relic or variant." });
      }

      return json(200, {
        command: {
          action: "giveRelic",
          relicId: body.relicId,
          variant: body.variant
        }
      });
    }

    case "heal":
      return json(200, { command: { action: "heal" } });

    // Create a globally redeemable coin code.
    case "createCode": {
      if (
        !validInt(body.rewardCoins, 1, 1000000) ||
        !validInt(body.maxRedemptions, 1, 100000)
      ) {
        return json(400, { error: "Invalid coin reward or redemption limit." });
      }

      let code;
      let saved = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        code = "RR-" + crypto.randomBytes(5).toString("hex").toUpperCase();

        const existing = await codes.get(code);
        if (existing !== null) continue;

        await codes.setJSON(code, {
          rewardCoins: body.rewardCoins,
          maxRedemptions: body.maxRedemptions,
          redeemed: 0,
          createdAt: new Date().toISOString()
        });

        saved = true;
        break;
      }

      if (!saved) {
        return json(500, { error: "Could not create a unique code. Try again." });
      }

      return json(200, {
        ok: true,
        code,
        rewardCoins: body.rewardCoins,
        maxRedemptions: body.maxRedemptions
      });
    }

    default:
      return json(400, { error: "Unknown admin action." });
  }
};
