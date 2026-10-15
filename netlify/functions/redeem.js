const { getStore } = require("@netlify/blobs");

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
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  if (!event.body || Buffer.byteLength(event.body, "utf8") > 1024) return json(413, { error: "Request is too large." });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: "Invalid JSON." }); }
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^RR-[A-F0-9]{10}$/.test(code)) return json(400, { error: "That giveaway code is not valid." });

  try {
    const store = getStore("relic-rush-reward-codes");
    const entry = await store.get(code, { type: "json" });
    if (!entry || !entry.reward) return json(404, { error: "That giveaway code does not exist." });
    if (entry.redeemed) return json(409, { error: "That giveaway code has already been redeemed." });

    // Mark it used before returning the reward so ordinary repeat attempts are rejected.
    // For high-traffic campaigns, use a transactional database with an atomic claim operation.
    await store.setJSON(code, { ...entry, redeemed: true, redeemedAt: new Date().toISOString() });
    return json(200, { reward: entry.reward });
  } catch (err) {
    return json(500, { error: "Reward storage is not ready. Check Netlify Blobs setup and redeploy." });
  }
};
