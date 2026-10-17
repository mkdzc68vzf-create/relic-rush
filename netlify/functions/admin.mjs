
import crypto from "node:crypto";

export default async (request) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers
    });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: "Admin secret is not configured" }), {
      status: 500, headers
    });
  }

  if (body.action !== "login" || typeof body.secret !== "string") {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers
    });
  }

  const supplied = Buffer.from(body.secret);
  const expected = Buffer.from(secret);

  if (supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)) {
    return new Response(JSON.stringify({ error: "Incorrect admin secret" }), {
      status: 401, headers
    });
  }

  const payload = Buffer.from(JSON.stringify({
    admin: true,
    expires: Date.now() + 15 * 60 * 1000
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return new Response(JSON.stringify({
    token: payload + "." + signature
  }), { status: 200, headers });
};
