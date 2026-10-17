
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relic Rush Admin</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;padding:20px;background:radial-gradient(circle at top,#32105b,#080414 70%);color:#fff;font-family:Arial,sans-serif}
.panel{max-width:580px;margin:30px auto;padding:24px;background:#160d2b;border:1px solid #7540ad;border-radius:20px;box-shadow:0 0 35px #8b35ff33}
h1{color:#c9a3ff}
p{color:#c6b8dd;line-height:1.5}
label{display:block;margin:15px 0 7px;font-weight:bold}
input,select{width:100%;padding:13px;border-radius:9px;border:1px solid #59357f;background:#0b0618;color:white;font-size:16px}
button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:9px;background:linear-gradient(90deg,#782cff,#d946ef);color:white;font-size:15px;font-weight:bold;cursor:pointer}
button:disabled{opacity:.6}
.secondary{background:#302044;border:1px solid #65428b}
#status{display:none;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:15px;padding:13px;border:1px solid #6844a0;border-radius:9px;background:#24163c}
#status.success{border-color:#4adea2}
#status.error{border-color:#f87191}
.small{font-size:12px;color:#a99abf}
[hidden]{display:none!important}
</style>
</head>
<body>
<main class="panel">
  <h1>🛡️ Relic Rush Admin</h1>
  <p>Sign in to manage worldwide giveaway codes.</p>

  <section id="loginPanel">
    <label for="secret">Admin Code</label>
    <input id="secret" type="password" autocomplete="current-password" placeholder="Enter admin code">
    <button id="loginButton">🔐 Login</button>
  </section>

  <section id="controls" hidden>
    <p>✅ Admin access verified.</p>

    <label for="reward">Coins per player</label>
    <select id="reward">
      <option value="100">100 Coins</option>
      <option value="500">500 Coins</option>
      <option value="1000" selected>1,000 Coins</option>
      <option value="2500">2,500 Coins</option>
      <option value="10000">10,000 Coins</option>
    </select>

    <label for="uses">Total worldwide uses</label>
    <input id="uses" type="number" min="1" max="100000" value="50">

    <label for="expiry">Expiry in days (blank = never)</label>
    <input id="expiry" type="number" min="1" max="3650" placeholder="Optional">

    <button id="generateButton">✨ Generate Giveaway Code</button>
    <button id="copyButton" class="secondary" hidden>📋 Copy Code</button>
    <button id="logoutButton" class="secondary">Log Out</button>
  </section>

  <div id="status" role="status" aria-live="polite"></div>
  <p class="small">Never share your admin code with viewers. Keep it in Netlify environment variables, not in your public game code.</p>
</main>

<script>
const $ = id => document.getElementById(id);
let adminSecret = "";
let generatedCode = "";

function show(message, type = "error") {
  $("status").textContent = message;
  $("status").className = type;
  $("status").style.display = "block";
}

$("loginButton").addEventListener("click", async () => {
  const candidate = $("secret").value;
  if (!candidate) {
    show("Enter your admin code.");
    return;
  }

  $("loginButton").disabled = true;
  $("loginButton").textContent = "Checking…";

  try {
    const response = await fetch("/.netlify/functions/verify-admin", {
      method: "POST",
      headers: {
        "x-relic-admin-code": candidate
      }
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Incorrect admin code.");
    }

    adminSecret = candidate;
    $("secret").value = "";
    $("loginPanel").hidden = true;
    $("controls").hidden = false;
    $("status").style.display = "none";
  } catch (error) {
    show(error.message || "Could not verify admin code.");
  } finally {
    $("loginButton").disabled = false;
    $("loginButton").textContent = "🔐 Login";
  }
});

$("generateButton").addEventListener("click", async () => {
  const uses = Number($("uses").value);
  const expiryDays = $("expiry").value;

  if (!Number.isInteger(uses) || uses < 1 || uses > 100000) {
    show("Enter a valid use limit.");
    return;
  }

  $("generateButton").disabled = true;
  $("generateButton").textContent = "Generating…";
  $("copyButton").hidden = true;

  try {
    const response = await fetch("/.netlify/functions/create-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-relic-admin-code": adminSecret
      },
      body: JSON.stringify({
        rewardCoins: Number($("reward").value),
        maxRedemptions: uses,
        expiryDays
      })
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Code generation failed.");
    }

    generatedCode = result.code;
    show(
      "🎉 CODE CREATED!\n\n" + result.code +
      "\nReward: " + result.rewardCoins + " coins per player" +
      "\nWorldwide uses: " + result.maxRedemptions +
      "\nExpires: " + (result.expiresAt
        ? new Date(result.expiresAt).toLocaleString()
        : "Never"),
      "success"
    );
    $("copyButton").hidden = false;
  } catch (error) {
    show(error.message || "Could not contact the server.");
  } finally {
    $("generateButton").disabled = false;
    $("generateButton").textContent = "✨ Generate Giveaway Code";
  }
});

$("copyButton").addEventListener("click", async () => {
  if (!generatedCode) return;
  try {
    await navigator.clipboard.writeText(generatedCode);
    show("Code copied: " + generatedCode, "success");
  } catch {
    show("Copy this code: " + generatedCode, "success");
  }
});

$("logoutButton").addEventListener("click", () => {
  adminSecret = "";
  generatedCode = "";
  $("controls").hidden = true;
  $("loginPanel").hidden = false;
  $("copyButton").hidden = true;
  $("secret").value = "";
  $("status").style.display = "none";
});
</script>
</body>
</html>
