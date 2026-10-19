
import { getStore } from "@netlify/blobs";

const codes = getStore("relic-rush-giveaway-codes");

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default async (request) => {
  if (request.method !== "POST") {
    return json(405, {
      ok: false,
      error: "Use POST."
    });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(400, {
      ok: false,
      error: "Invalid request."
    });
  }

  const code =
    typeof body.code === "string"
      ? body.code.trim().toUpperCase()
      : "";

  if (!/^RR-[A-F0-9]{10}$/.test(code)) {
    return json(400, {
      ok: false,
      error: "Enter a valid giveaway code."
    });
  }

  try {
    const record = await codes.get(code, { type: "json" });

    if (!record) {
      return json(404, {
        ok: false,
        error: "Code not found."
      });
    }

    if (
      !Number.isSafeInteger(record.maxRedemptions) ||
      record.maxRedemptions < 1 ||
      !Number.isSafeInteger(record.redeemed) ||
      record.redeemed < 0
    ) {
      return json(500, {
        ok: false,
        error: "This code has invalid redemption data."
      });
    }

    if (record.redeemed >= record.maxRedemptions) {
      return json(409, {
        ok: false,
        error: "This giveaway code has reached its redemption limit."
      });
    }

    let result;

    if (record.rewardType === "coins") {
      if (
        !Number.isSafeInteger(record.rewardCoins) ||
        record.rewardCoins < 1
      ) {
        return json(500, {
          ok: false,
          error: "Invalid coin reward saved for this code."
        });
      }

      result = {
        ok: true,
        rewardType: "coins",
        rewardCoins: record.rewardCoins,
        message: `Code redeemed! You received ${record.rewardCoins.toLocaleString()} coins.`
      };
    } else if (record.rewardType === "relics") {
      if (
        !/^r(?:[0-9]|1[0-9]|2[0-3])$/.test(record.relicId || "") ||
        !["normal", "diamond", "gold", "candy"].includes(record.variant) ||
        !Number.isSafeInteger(record.rewardAmount) ||
        record.rewardAmount < 1 ||
        record.rewardAmount > 100000
      ) {
        return json(500, {
          ok: false,
          error: "Invalid relic reward saved for this code."
        });
      }

      result = {
        ok: true,
        rewardType: "relics",
        rewardAmount: record.rewardAmount,
        relicId: record.relicId,
        variant: record.variant,
        message: `Code redeemed! You received ${record.rewardAmount} relic(s).`
      };
    } else {
      return json(500, {
        ok: false,
        error: "Unknown reward type."
      });
    }

    // Update the redemption count before returning the reward.
    record.redeemed += 1;
    record.lastRedeemedAt = new Date().toISOString();

    await codes.setJSON(code, record);

    return json(200, result);
  } catch (error) {
    console.error("Giveaway redemption error:", error);

    return json(500, {
      ok: false,
      error: "The redemption service encountered a server error."
    });
  }
};

