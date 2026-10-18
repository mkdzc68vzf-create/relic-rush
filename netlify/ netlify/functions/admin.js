
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

  return (
    aa.length === bb.length &&
    crypto.timingSafeEqual(aa, bb)
  );
}

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

function verify(token, secret) {
  if (typeof token !== "string" || token.length > 2048) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(parts[0])
    .digest("base64url");

  if (!safeEqual(parts[1], expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );

    if (
      payload.role !== "admin" ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function validInt(value, min, max) {
  return (
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, {
      ok: false,
      error: "Use POST."
    });
  }

  if (
    !event.body ||
    Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES
  ) {
    return json(413, {
      ok: false,
      error: "Request is empty or too large."
    });
  }

  const origin = event.headers?.origin || event.headers?.Origin;

  if (ALLOWED_ORIGIN && origin) {
    try {
      if (new URL(origin).host !== new URL(ALLOWED_ORIGIN).host) {
        return json(403, {
          ok: false,
          error: "Origin not allowed."
        });
      }
    } catch {
      return json(403, {
        ok: false,
        error: "Invalid origin."
      });
    }
  }

  const adminCode = process.env.RELIC_RUSH_ADMIN_CODE;
  const sessionSecret = process.env.RELIC_RUSH_SESSION_SECRET;

  if (
    !adminCode ||
    adminCode.length < 8 ||
    !sessionSecret ||
    sessionSecret.length < 32
  ) {
    return json(500, {
      ok: false,
      error: "Admin environment variables are not configured."
    });
  }

  let body;

  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, {
      ok: false,
      error: "Invalid JSON."
    });
  }

  // ADMIN LOGIN
  if (body.action === "login") {
    if (
      typeof body.code !== "string" ||
      !safeEqual(body.code, adminCode)
    ) {
      return json(401, {
        ok: false,
        error: "Incorrect admin password."
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = (now + SESSION_TTL_SECONDS) * 1000;

    const token = sign(
      {
        role: "admin",
        iat: now,
        exp: now + SESSION_TTL_SECONDS,
        nonce: crypto.randomBytes(16).toString("hex")
      },
      sessionSecret
    );

    // FIX: The frontend expects ok: true.
    return json(200, {
      ok: true,
      token,
      expiresAt
    });
  }

  // ALL OTHER ACTIONS REQUIRE A VALID SESSION
  if (!verify(body.token, sessionSecret)) {
    return json(401, {
      ok: false,
      error: "Admin session expired. Log in again."
    });
  }

  switch (body.action) {
    case "giveCoins": {
      if (!validInt(body.amount, 1, 1000000)) {
        return json(400, {
          ok: false,
          error: "Coins must be from 1 to 1,000,000."
        });
      }

      return json(200, {
        ok: true,
        command: {
          action: "giveCoins",
          amount: body.amount
        }
      });
    }

    case "setCoins": {
      if (!validInt(body.amount, 0, 10000000)) {
        return json(400, {
          ok: false,
          error: "Balance must be from 0 to 10,000,000."
        });
      }

      return json(200, {
        ok: true,
        command: {
          action: "setCoins",
          amount: body.amount
        }
      });
    }

    case "giveRelic": {
      const validRelic = /^r(?:[0-9]|1[0-9]|2[0-3])$/.test(
        body.relicId || ""
      );

      const validVariant = [
        "normal",
        "gold",
        "candy"
      ].includes(body.variant);

      if (!validRelic || !validVariant) {
        return json(400, {
          ok: false,
          error: "Invalid relic or variant."
        });
      }

      return json(200, {
        ok: true,
        command: {
          action: "giveRelic",
          relicId: body.relicId,
          variant: body.variant
        }
      });
    }

    case "heal": {
      return json(200, {
        ok: true,
        command: {
          action: "heal"
        }
      });
    }

    <h3 style="margin-top:20px">🎁 Giveaway Code Generator</h3>

<label for="adminRewardType">Reward type</label>
<select id="adminRewardType" class="full" style="width:100%">
  <option value="coins">🪙 Coins</option>
  <option value="relics">💎 Relics</option>
</select>

<label for="adminReward" class="small">Reward amount</label>
<input id="adminReward" type="number" min="1" max="1000000"
  value="5000" class="full" style="width:100%">

<div id="adminCodeRelicFields">
  <label for="adminCodeRelic" class="small">Relic to award</label>
  <select id="adminCodeRelic" class="full" style="width:100%"></select>

  <label for="adminCodeVariant" class="small">Relic variant</label>
  <select id="adminCodeVariant" class="full" style="width:100%">
    <option value="normal">Normal</option>
    <option value="diamond">💎 Diamond</option>
    <option value="gold">🌟 Gold</option>
    <option value="candy">🍬 Candy Corn</option>
  </select>
  <p class="small">For relic rewards, the amount is the number of copies awarded.</p>
</div>

<label for="adminUses" class="small">Maximum worldwide redemptions</label>
<input id="adminUses" type="number" min="1" max="100000"
  value="1" class="full" style="width:100%">

<button class="btn full" id="adminMakeCodeBtn">
  Generate Worldwide Code
</button>

<div id="adminCodeResult" class="notice"
  style="display:none;overflow-wrap:anywhere"></div>
    default:
      return json(400, {
        ok: false,
        error: "Unknown admin action."
      });
  }
};
