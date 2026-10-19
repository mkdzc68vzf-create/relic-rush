
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const events = getStore("relic-rush-events");
const announcements = getStore("relic-rush-event-announcements");

const ALLOWED_ORIGIN = process.env.URL || "";
const SESSION_SECRET = process.env.RELIC_RUSH_SESSION_SECRET || "";
const MAX_BODY_BYTES = 8192;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function validAdmin(token) {
  if (!SESSION_SECRET || typeof token !== "string" || token.length > 2048) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(parts[0])
    .digest("base64url");

  if (!safeEqual(parts[1], expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );

    return payload.role === "admin" &&
      Number.isInteger(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function validDate(value) {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value));
}

function isActive(event, now = Date.now()) {
  return event &&
    event.enabled === true &&
    Date.parse(event.startAt) <= now &&
    Date.parse(event.endAt) > now;
}

export default async (request) => {
  if (!["GET", "POST"].includes(request.method)) {
    return json(405, { ok: false, error: "Use GET or POST." });
  }

  const origin = request.headers.get("origin");

  if (ALLOWED_ORIGIN && origin) {
    try {
      if (new URL(origin).host !== new URL(ALLOWED_ORIGIN).host) {
        return json(403, { ok: false, error: "Origin not allowed." });
      }
    } catch {
      return json(403, { ok: false, error: "Invalid origin." });
    }
  }

  if (request.method === "GET") {
    try {
      const event = await events.get("current", { type: "json" });
      const savedNotice = await announcements.get("latest", { type: "json" });
const notice = savedNotice && Date.parse(savedNotice.expiresAt) > Date.now()
  ? savedNotice
  : null;
      const now = Date.now();

      return json(200, {
        ok: true,
        serverTime: new Date(now).toISOString(),
        event: isActive(event, now) ? event : null,
        upcomingEvent: event &&
          event.enabled === true &&
          Date.parse(event.startAt) > now ? event : null,
        announcement: notice || null
      });
    } catch {
      return json(500, {
        ok: false,
        error: "Could not load events."
      });
    }
  }

  const raw = await request.text();

  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "Request is empty or too large." });
  }

  let body;

  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "Invalid JSON." });
  }

  if (!validAdmin(body.token)) {
    return json(401, {
      ok: false,
      error: "Admin session expired. Log in again."
    });
  }
  
  if (body.action === "announce") {
    const message = typeof body.message === "string"
      ? body.message.trim().slice(0, 300)
      : "";

    const durationSeconds = Number(body.durationSeconds ?? 30);

    if (!message) {
      return json(400, {
        ok: false,
        error: "Enter an announcement message."
      });
    }

    if (!Number.isInteger(durationSeconds) ||
        durationSeconds < 5 || durationSeconds > 3600) {
      return json(400, {
        ok: false,
        error: "Duration must be 5 to 3600 seconds."
      });
    }

    const now = Date.now();

    const notice = {
      id: crypto.randomUUID(),
      title: "📢 Message from the Admin",
      message,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationSeconds * 1000).toISOString()
    };

    await announcements.setJSON("latest", notice);

    return json(200, { ok: true, announcement: notice });
  }

  if (body.action === "clearAnnouncement") {
    await announcements.delete("latest");
    return json(200, { ok: true });
  }

  if (body.action === "start") {
    const title = typeof body.title === "string"
      ? body.title.trim().slice(0, 80)
      : "";

    const message = typeof body.message === "string"
      ? body.message.trim().slice(0, 240)
      : "";

    const durationMinutes = Number(body.durationMinutes ?? 30);

    if (!title || !message) {
      return json(400, {
        ok: false,
        error: "Enter an event title and announcement."
      });
    }

    if (!Number.isInteger(durationMinutes) ||
        durationMinutes < 1 || durationMinutes > 10080) {
      return json(400, {
        ok: false,
        error: "Duration must be 1 minute to 7 days."
      });
    }

    const startAt = validDate(body.startAt)
      ? new Date(body.startAt).toISOString()
      : new Date().toISOString();

    const endAt = validDate(body.endAt)
      ? new Date(body.endAt).toISOString()
      : new Date(Date.parse(startAt) +
          durationMinutes * 60 * 1000).toISOString();

    if (Date.parse(endAt) <= Date.parse(startAt)) {
      return json(400, {
        ok: false,
        error: "Event end must be after its start."
      });
    }

    const event = {
      id: crypto.randomUUID(),
      title,
      message,
      enabled: true,
      startAt,
      endAt,
      rareLuckMultiplier: 1.5,
      coinMultiplier: 2,
      automaticRewards: [],
      claimableRewards: [],
      createdAt: new Date().toISOString()
    };

    await events.setJSON("current", event);
    await announcements.setJSON("latest", {
      id: event.id,
      title,
      message,
      createdAt: new Date().toISOString()
    });

    return json(200, { ok: true, event });
  }

  if (body.action === "schedule") {
    const title = typeof body.title === "string"
      ? body.title.trim().slice(0, 80)
      : "";

    const message = typeof body.message === "string"
      ? body.message.trim().slice(0, 240)
      : "";

    if (!title || !message ||
        !validDate(body.startAt) || !validDate(body.endAt) ||
        Date.parse(body.endAt) <= Date.parse(body.startAt)) {
      return json(400, {
        ok: false,
        error: "Provide a title, message, and valid start/end dates."
      });
    }

    const event = {
      id: crypto.randomUUID(),
      title,
      message,
      enabled: true,
      startAt: new Date(body.startAt).toISOString(),
      endAt: new Date(body.endAt).toISOString(),
      eventType: ["luck", "coins", "both"].includes(body.eventType)
  ? body.eventType
  : "both",

rareLuckMultiplier: ["luck", "both"].includes(body.eventType)
  ? 1.5
  : 1,

coinMultiplier: ["coins", "both"].includes(body.eventType)
  ? 2
  : 1,
      automaticRewards: [],
      claimableRewards: [],
      createdAt: new Date().toISOString()
    };

    await events.setJSON("current", event);
    await announcements.setJSON("latest", {
      id: event.id,
      title,
      message,
      createdAt: new Date().toISOString()
    });

    return json(200, { ok: true, event });
  }

  if (body.action === "end") {
    const event = await events.get("current", { type: "json" });

    if (!event) {
      return json(404, { ok: false, error: "No event exists." });
    }

    event.enabled = false;
    event.endedAt = new Date().toISOString();
    await events.setJSON("current", event);

    await announcements.setJSON("latest", {
      id: event.id,
      title: "Event ended",
      message: `${event.title} has ended.`,
      createdAt: new Date().toISOString()
    });

    return json(200, { ok: true, event });
  }

  return json(400, {
    ok: false,
    error: "Unknown action. Use start, schedule, or end."
  });
};
