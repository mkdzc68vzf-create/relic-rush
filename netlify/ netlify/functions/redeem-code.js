
const { getStore } = require("@netlify/blobs");

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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Use POST." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > 1024) {
    return json(400, { ok: false, error: "Invalid request." });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { ok: false, error: "Invalid JSON." });
  }

  const code = typeof body.code === "string"
    ? body.code.trim().toUpperCase()
    : "";

  if (!/^RR-[A-F0-9]{10}$/.test(code)) {
    return json(400, { ok: false, error: "Invalid giveaway code." });
  }

  try {
    const record = await codes.get(code, { type: "json" });

    if (!record) {
      return json(404, { ok: false, error: "Code not found." });
    }

    if (
      !Number.isSafeInteger(record.rewardCoins) ||
      !Number.isSafeInteger(record.maxRedemptions) ||
      !Number.isSafeInteger(record.redeemed)
    ) {
      return json(500, { ok: false, error: "Invalid code record." });
    }

    if (record.redeemed >= record.maxRedemptions) {
      return json(410, { ok: false, error: "This code has reached its redemption limit." });
    }

    // Save the redemption count on the server.
    record.redeemed += 1;
    await codes.setJSON(code, record);

    return json(200, {
      ok: true,
      rewardCoins: record.rewardCoins,
      message: `Code redeemed! You received ${record.rewardCoins.toLocaleString()} coins.`
    });
  } catch (error) {
    console.error("Redeem code error:", error);
    return json(500, { ok: false, error: "Could not redeem the code right now." });
  }
};
