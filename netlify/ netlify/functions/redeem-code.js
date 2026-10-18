
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
      !Number.isSafeInteger(record.maxRedemptions) ||
      !Number.isSafeInteger(record.redeemed) ||
      record.maxRedemptions < 1 ||
      record.redeemed < 0
    ) {
      return json(500, { ok: false, error: "Invalid code record." });
    }

    if (record.redeemed >= record.maxRedemptions) {
      return json(410, {
        ok: false,
        error: "This code has reached its redemption limit."
      });
    }

    const rewardType = record.rewardType || "coins";

    if (rewardType === "coins") {
      if (!Number.isSafeInteger(record.rewardCoins) || record.rewardCoins < 1) {
        return json(500, { ok: false, error: "Invalid coin reward." });
      }
    } else if (rewardType === "relics") {
      if (!Number.isSafeInteger(record.rewardAmount) || record.rewardAmount < 1) {
        return json(500, { ok: false, error: "Invalid relic reward." });
      }
    } else {
      return json(500, { ok: false, error: "Unknown reward type." });
    }

    // NOTE: This read-then-write counter is not atomic.
    // Simultaneous requests can exceed the limit.
    record.redeemed += 1;
    await codes.setJSON(code, record);

    
if (rewardType === "relics") {
  if (
    !/^r(?:[0-9]|1[0-9]|2[0-3])$/.test(record.relicId || "") ||
    !["normal", "diamond", "gold", "candy"].includes(record.variant) ||
    !Number.isSafeInteger(record.rewardAmount) ||
    record.rewardAmount < 1
  ) {
    return json(500, {
      ok: false,
      error: "Invalid relic reward."
    });
  }

  return json(200, {
    ok: true,
    rewardType: "relics",
    rewardAmount: record.rewardAmount,
    relicId: record.relicId,
    variant: record.variant,
    message: `Code redeemed! Reward: ${record.rewardAmount} relic copies.`
  });
}


    return json(200, {
      ok: true,
      rewardType: "coins",
      rewardCoins: record.rewardCoins,
      message: `Code redeemed! You received ${record.rewardCoins.toLocaleString()} coins.`
    });
  } catch (error) {
    console.error("Redeem code error:", error);
    return json(500, {
      ok: false,
      error: "Could not redeem the code right now."
    });
  }
};
