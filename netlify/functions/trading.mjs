
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
let pool;

function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable"
        ? false
        : { rejectUnauthorized: false }
    });
  }

  return pool;
}

function response(statusCode, data) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin":
        process.env.SITE_ORIGIN || "null",
      "access-control-allow-headers":
        "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    },
    body: JSON.stringify(data)
  };
}

function secret() {
  const value = process.env.RELIC_RUSH_SESSION_SECRET;

  if (!value || value.length < 32) {
    throw new Error(
      "RELIC_RUSH_SESSION_SECRET must be at least 32 characters"
    );
  }

  return value;
}

function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    uid: String(userId),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function readToken(token) {
  try {
    const [payload, signature] = String(token || "").split(".");

    if (!payload || !signature) return null;

    const expected = crypto
      .createHmac("sha256", secret())
      .update(payload)
      .digest();

    const actual = Buffer.from(signature, "base64url");

    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function passwordHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });
}

async function authenticatedUser(event) {
  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";

  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  const payload = readToken(token);
  if (!payload) return null;

  const result = await db().query(
    "SELECT id, username FROM rr_accounts WHERE id = $1",
    [payload.uid]
  );

  return result.rows[0] || null;
}

const validVariants = new Set([
  "normal", "gold", "candy", "diamond"
]);

function validRelic(relic) {
  return relic &&
    typeof relic.relicId === "string" &&
    /^r\d{1,3}$/.test(relic.relicId) &&
    validVariants.has(relic.variant || "normal");
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return response(204, {});
  }

  try {
    const body = parseBody(event);
    const action = body.action;

    if (event.httpMethod === "GET") {
      return response(200, {
        ok: true,
        service: "Relic Rush trading API"
      });
    }

    // CREATE ACCOUNT
    if (action === "register") {
      if (
        typeof body.username !== "string" ||
        !/^[a-zA-Z0-9_]{3,20}$/.test(body.username) ||
        typeof body.password !== "string" ||
        body.password.length < 8 ||
        body.password.length > 200
      ) {
        return response(400, {
          error: "Use a 3–20 character username and a password of at least 8 characters."
        });
      }

      const username = body.username;
      const salt = crypto.randomBytes(16).toString("hex");
      const storedHash = await passwordHash(body.password, salt);

      try {
        const result = await db().query(
          `INSERT INTO rr_accounts
           (username, username_norm, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, username`,
          [
            username,
            username.toLowerCase(),
            `${salt}:${storedHash}`
          ]
        );

        const account = result.rows[0];

        return response(201, {
          token: makeToken(account.id),
          account
        });
      } catch (error) {
        if (error.code === "23505") {
          return response(409, {
            error: "That username is already taken."
          });
        }
        throw error;
      }
    }

    // LOG IN
    if (action === "login") {
      if (
        typeof body.username !== "string" ||
        typeof body.password !== "string"
      ) {
        return response(400, {
          error: "Enter your username and password."
        });
      }

      const result = await db().query(
        `SELECT id, username, password_hash
         FROM rr_accounts WHERE username_norm = $1`,
        [body.username.trim().toLowerCase()]
      );

      const account = result.rows[0];

      if (!account) {
        return response(401, {
          error: "Incorrect username or password."
        });
      }

      const [salt, savedHash] = account.password_hash.split(":");
      const enteredHash = await passwordHash(body.password, salt);

      const a = Buffer.from(savedHash, "hex");
      const b = Buffer.from(enteredHash, "hex");

      if (
        a.length !== b.length ||
        !crypto.timingSafeEqual(a, b)
      ) {
        return response(401, {
          error: "Incorrect username or password."
        });
      }

      return response(200, {
        token: makeToken(account.id),
        account: {
          id: account.id,
          username: account.username
        }
      });
    }

    // ALL OTHER ACTIONS REQUIRE LOGIN
    const user = await authenticatedUser(event);

    if (!user) {
      return response(401, { error: "Please log in first." });
    }

    // VIEW SERVER INVENTORY
    if (action === "inventory") {
      const result = await db().query(
        `SELECT id, relic_id AS "relicId", variant, serial,
                verification_status AS "verificationStatus",
                acquired_at AS "acquiredAt"
         FROM rr_inventory
         WHERE owner_id = $1
         ORDER BY acquired_at DESC`,
        [user.id]
      );

      return response(200, { inventory: result.rows });
    }

    // IMPORT CURRENT LOCAL INVENTORY ONCE
    if (action === "importInventory") {
      if (
        !Array.isArray(body.relics) ||
        body.relics.length > 1000 ||
        !body.relics.every(validRelic)
      ) {
        return response(400, {
          error: "Invalid inventory. Maximum 1000 relics."
        });
      }

      const client = await db().connect();

      try {
        await client.query("BEGIN");

        const account = await client.query(
          "SELECT imported_at FROM rr_accounts WHERE id=$1 FOR UPDATE",
          [user.id]
        );

        if (!account.rows[0] || account.rows[0].imported_at) {
          await client.query("ROLLBACK");
          return response(409, {
            error: "The one-time inventory import has already been used."
          });
        }

        for (const relic of body.relics) {
          await client.query(
            `INSERT INTO rr_inventory
             (owner_id, relic_id, variant, serial, verification_status)
             VALUES ($1, $2, $3, $4, 'imported_unverified')`,
            [
              user.id,
              relic.relicId,
              relic.variant || "normal",
              relic.serial == null ? null : String(relic.serial).slice(0, 100)
            ]
          );
        }

        await client.query(
          "UPDATE rr_accounts SET imported_at=NOW() WHERE id=$1",
          [user.id]
        );

        await client.query("COMMIT");

        return response(200, {
          imported: body.relics.length,
          verificationStatus: "imported_unverified"
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    // CREATE A TRADE REQUEST
    if (action === "createTrade") {
      if (
        typeof body.toUsername !== "string" ||
        !Array.isArray(body.offerIds) ||
        !Array.isArray(body.requestIds) ||
        body.offerIds.length > 100 ||
        body.requestIds.length > 100 ||
        (!body.offerIds.length && !body.requestIds.length)
      ) {
        return response(400, {
          error: "Choose a player and at least one relic."
        });
      }

      const client = await db().connect();

      try {
        await client.query("BEGIN");

        const targetResult = await client.query(
          `SELECT id, username FROM rr_accounts
           WHERE username_norm=$1`,
          [body.toUsername.trim().toLowerCase()]
        );

        const target = targetResult.rows[0];

        if (!target || String(target.id) === String(user.id)) {
          await client.query("ROLLBACK");
          return response(400, {
            error: "Recipient not found or invalid."
          });
        }

        const offers = [...new Set(body.offerIds)];
        const requests = [...new Set(body.requestIds)];

        for (const id of offers) {
          const owned = await client.query(
            "SELECT id FROM rr_inventory WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [id, user.id]
          );

          if (!owned.rowCount) {
            await client.query("ROLLBACK");
            return response(400, {
              error: "An offered relic is not yours."
            });
          }
        }

        for (const id of requests) {
          const owned = await client.query(
            "SELECT id FROM rr_inventory WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [id, target.id]
          );

          if (!owned.rowCount) {
            await client.query("ROLLBACK");
            return response(400, {
              error: "A requested relic is not owned by that player."
            });
          }
        }

        const trade = await client.query(
          `INSERT INTO rr_trades (from_account, to_account)
           VALUES ($1, $2) RETURNING id`,
          [user.id, target.id]
        );

        const tradeId = trade.rows[0].id;

        for (const id of offers) {
          await client.query(
            `INSERT INTO rr_trade_items
             (trade_id, inventory_id, original_owner)
             VALUES ($1, $2, $3)`,
            [tradeId, id, user.id]
          );
        }

        for (const id of requests) {
          await client.query(
            `INSERT INTO rr_trade_items
             (trade_id, inventory_id, original_owner)
             VALUES ($1, $2, $3)`,
            [tradeId, id, target.id]
          );
        }

        await client.query("COMMIT");

        return response(201, {
          tradeId,
          status: "pending"
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    // VIEW YOUR TRADE REQUESTS
    if (action === "listTrades") {
      const result = await db().query(
        `SELECT t.id, t.status, t.created_at AS "createdAt",
                sender.username AS "fromUsername",
                recipient.username AS "toUsername",
                t.from_account AS "fromId",
                t.to_account AS "toId"
         FROM rr_trades t
         JOIN rr_accounts sender ON sender.id=t.from_account
         JOIN rr_accounts recipient ON recipient.id=t.to_account
         WHERE t.from_account=$1 OR t.to_account=$1
         ORDER BY t.created_at DESC LIMIT 100`,
        [user.id]
      );

      return response(200, { trades: result.rows });
    }

    // ACCEPT OR REJECT A TRADE
    if (action === "respondTrade") {
      if (
        typeof body.tradeId !== "string" ||
        !["accept", "reject"].includes(body.decision)
      ) {
        return response(400, { error: "Invalid trade response." });
      }

      const client = await db().connect();

      try {
        await client.query("BEGIN");

        const result = await client.query(
          "SELECT * FROM rr_trades WHERE id=$1 FOR UPDATE",
          [body.tradeId]
        );

        const trade = result.rows[0];

        if (
          !trade ||
          String(trade.to_account) !== String(user.id) ||
          trade.status !== "pending"
        ) {
          await client.query("ROLLBACK");
          return response(404, {
            error: "Pending trade not found."
          });
        }

        if (body.decision === "reject") {
          await client.query(
            "UPDATE rr_trades SET status='rejected', completed_at=NOW() WHERE id=$1",
            [trade.id]
          );

          await client.query("COMMIT");
          return response(200, { status: "rejected" });
        }

        const items = await client.query(
          "SELECT inventory_id, original_owner FROM rr_trade_items WHERE trade_id=$1",
          [trade.id]
        );

        for (const item of items.rows) {
          const owned = await client.query(
            "SELECT id FROM rr_inventory WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [item.inventory_id, item.original_owner]
          );

          if (!owned.rowCount) {
            await client.query("ROLLBACK");
            return response(409, {
              error: "A relic changed owners. This trade cannot complete."
            });
          }
        }

        for (const item of items.rows) {
          const newOwner =
            String(item.original_owner) === String(trade.from_account)
              ? trade.to_account
              : trade.from_account;

          await client.query(
            "UPDATE rr_inventory SET owner_id=$1 WHERE id=$2",
            [newOwner, item.inventory_id]
          );
        }

        await client.query(
          "UPDATE rr_trades SET status='accepted', completed_at=NOW() WHERE id=$1",
          [trade.id]
        );

        await client.query("COMMIT");
        return response(200, { status: "accepted" });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    // CREATE A SINGLE-USE TRADE CODE
    if (action === "createTradeCode") {
      if (typeof body.inventoryId !== "string") {
        return response(400, { error: "Choose a relic." });
      }

      const hours = Math.min(168, Math.max(1, Number(body.hours) || 24));
      const code = crypto.randomBytes(6).toString("hex").toUpperCase();

      const result = await db().query(
        `INSERT INTO rr_trade_codes
         (code_hash, inventory_id, owner_id, expires_at)
         SELECT $1, id, owner_id, NOW() + ($2 * INTERVAL '1 hour')
         FROM rr_inventory WHERE id=$3 AND owner_id=$4
         RETURNING id`,
        [hash(code), hours, body.inventoryId, user.id]
      );

      if (!result.rowCount) {
        return response(404, {
          error: "That relic is not in your inventory."
        });
      }

      return response(201, {
        code,
        expiresInHours: hours
      });
    }

    // REDEEM A TRADE CODE
    if (action === "redeemTradeCode") {
      if (typeof body.code !== "string") {
        return response(400, { error: "Enter a trade code." });
      }

      const client = await db().connect();

      try {
        await client.query("BEGIN");

        const result = await client.query(
          "SELECT * FROM rr_trade_codes WHERE code_hash=$1 FOR UPDATE",
          [hash(body.code.trim().toUpperCase())]
        );

        const code = result.rows[0];

        if (
          !code ||
          code.redeemed_at ||
          new Date(code.expires_at) < new Date() ||
          String(code.owner_id) === String(user.id)
        ) {
          await client.query("ROLLBACK");
          return response(400, {
            error: "Code is invalid, expired, already used, or belongs to you."
          });
        }

        const inventory = await client.query(
          "SELECT id FROM rr_inventory WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [code.inventory_id, code.owner_id]
        );

        if (!inventory.rowCount) {
          await client.query("ROLLBACK");
          return response(409, {
            error: "That relic is no longer available."
          });
        }

        await client.query(
          "UPDATE rr_inventory SET owner_id=$1 WHERE id=$2",
          [user.id, code.inventory_id]
        );

        await client.query(
          "UPDATE rr_trade_codes SET redeemed_by=$1, redeemed_at=NOW() WHERE id=$2",
          [user.id, code.id]
        );

        await client.query("COMMIT");
        return response(200, { redeemed: true });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return response(400, { error: "Unknown action." });
  } catch (error) {
    console.error("Relic Rush trading API:", error);
    return response(500, {
      error: "Server error. Check Netlify function logs and environment variables."
    });
  }
}
