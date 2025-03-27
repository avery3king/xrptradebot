const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const qs = require("qs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;
const ALLOWED_USER_ID = process.env.ALLOWED_TELEGRAM_ID;
const DAILY_LIMIT = 500;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
let lastTradeTime = 0;

function getKrakenSignature(path, requestData, secret, nonce) {
  const message = qs.stringify(requestData);
  const secretBuffer = Buffer.from(secret, 'base64');
  const hash = crypto.createHash('sha256');
  const hmac = crypto.createHmac('sha512', secretBuffer);
  const hash_digest = hash.update(nonce + message).digest();
  const hmac_digest = hmac.update(path + hash_digest).digest('base64');
  return hmac_digest;
}

// Track daily limit
let today = new Date().toISOString().slice(0, 10);
let spentToday = 0;

app.get("/trade", async (req, res) => {
  const { coin = "XRP", amount = "100", type = "buy", user = "" } = req.query;

  // Validate user
  if (user !== ALLOWED_USER_ID) {
    return res.status(403).send("❌ Unauthorized user.");
  }

  // Cooldown check
  const now = Date.now();
  if (now - lastTradeTime < COOLDOWN_MS) {
    return res.status(429).send("⏳ Cooldown in effect. Please wait before trading again.");
  }

  // Daily limit check
  const todayNow = new Date().toISOString().slice(0, 10);
  if (todayNow !== today) {
    today = todayNow;
    spentToday = 0;
  }
  if (spentToday + parseFloat(amount) > DAILY_LIMIT) {
    return res.status(403).send("💰 Daily limit exceeded.");
  }

  // Kraken Market Order
  const pair = `${coin}/USD`.toUpperCase();
  const nonce = Date.now() * 1000;
  const requestData = {
    nonce,
    pair,
    type: type.toLowerCase(),
    ordertype: "market",
    volume: amount
  };

  const path = "/0/private/AddOrder";
  const signature = getKrakenSignature(path, requestData, API_SECRET, nonce);

  try {
    const response = await axios.post("https://api.kraken.com" + path, qs.stringify(requestData), {
      headers: {
        "API-Key": API_KEY,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const result = response.data;
    if (result.error && result.error.length) {
      return res.status(500).send("❌ Kraken error: " + result.error.join(", "));
    }

    lastTradeTime = now;
    spentToday += parseFloat(amount);
    return res.send("✅ Trade executed: " + JSON.stringify(result.result));
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("❌ Trade failed: " + err.message);
  }
});

app.listen(port, () => {
  console.log(`✅ Trade bot running on port ${port}`);
});
