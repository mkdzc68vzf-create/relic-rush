
const { getStore } = require("@netlify/blobs");

function reply(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method not allowed." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { ok: false, error: "Invalid request." });
  }

  if (typeof body.code !== "string" || body.code.length > 40) {
    return reply(400, { ok: false, error: "Enter a valid giveaway code." });
  }

  const code = body.code.trim().toUpperCase();

  try {
    const store = getStore("relic-rush-codes");
    const key = `code:${code}`;
    const record = await store.get(key, { type: "json" });

    if (!record) {
      return reply(404, { ok: false, error: "Code not found." });
    }

    if (record.expiresAt && Date.now() >= record.expiresAt) {
      return reply(410, { ok: false, error: "This code has expired." });
    }

    if (record.redemptions >= record.maxRedemptions) {
      return reply(410, { ok: false, error: "This code has reached its use limit." });
    }

    record.redemptions += 1;
    await store.setJSON(key, record);

    return reply(200, {
      ok: true,
      rewardCoins: record.rewardCoins,
      redemptions: record.redemptions,
      maxRedemptions: record.maxRedemptions
    });
  } catch (error) {
    console.error("Code redemption failed:", error);
    return reply(500, {
      ok: false,
      error: "Could not redeem the code. Please try again."
    });
  }
};
