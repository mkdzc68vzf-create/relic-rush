const crypto = require("crypto");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function response(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return response(405, { ok: false, error: "Method not allowed." });
  }

  const adminCode = process.env.RELIC_RUSH_ADMIN_CODE;
  const sessionSecret = process.env.RELIC_RUSH_SESSION_SECRET;

  if (!adminCode || !sessionSecret) {
    console.error("Required admin environment variables are missing.");
    return response(500, {
      ok: false,
      error: "Admin login is not configured on the server."
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return response(400, { ok: false, error: "Invalid request." });
  }

  if (body.action !== "login" || typeof body.code !== "string") {
    return response(400, { ok: false, error: "Invalid login request." });
  }

  if (!safeEqual(body.code, adminCode)) {
    return response(401, { ok: false, error: "Incorrect admin code." });
  }

  const payload = Buffer.from(JSON.stringify({
    sub: "relic-rush-admin",
    exp: Date.now() + 2 * 60 * 60 * 1000
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  return response(200, {
    ok: true,
    token: `${payload}.${signature}`
  });
};
