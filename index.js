const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const qs = require("qs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;
const TELEGRAM_USER_ID = process.env.ALLOWED_TELEGRAM_ID;
const DAILY_LIMIT = 500; // USD
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

function getTodayFileName() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `./logs/spent-${date}.json`;
}

function getTodaySpent() {
  const file = getTodayFileName();
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file));
    return data.total || 0;
  }
  return 0;
}

function logTodaySpend(amount) {
  const file = getTodayFileName();
  const total = getTodaySpent() + parseFloat(amount);
  fs.writeFileSync(file, JSON.stringify({ total }));
}

async function getKrakenXRPBalance() {
  const nonce = Date.now() * 1000;
  const requestData = { nonce };
  const path = "/0/private/Balance";
  const signature = getKrakenSignature(path, requestData, API_SECRET, nonce);

  const headers = {
    "API-Key": API_KEY,
    "API-Sign": signature,
    "Content-Type": "application/x-www-form-urlencoded"
  };

  const response = await axios.post(
    "https://api.kraken.com" + path,
    qs.stringify(requestData),
    { headers }
  );

  const result = response.data;
  if (result.error && result.error.length) {
    throw new Error(result.error.join(", "));
  }

  const balances = result.result;
  return parseFloat(balances["XXRP"] || 0); // Kraken's XRP ticker is "XXRP"
}

app.get("/trade", async (req, res) => {
  const { coin = "XRP", amount = "100", type = "buy", user = "" } = req.query;

  // 1. Telegram user validation
  if (user !== TELEGRAM_USER_ID) {
    return res.status(403).send("❌ Unauthorized user.");
  }

  // 2. Cooldown check
  const now = Date.now();
  if (now - lastTradeTime < COOLDOWN_MS) {
    return res.status(429).send("⏳ Trade cooldown in effect. Try again later.");
  }

  // 3. Daily limit check (for buys)
  if (type === "buy") {
    const todaySpent = getTodaySpent();
    if (todaySpent + parseFloat(amount) > DAILY_LIMIT) {
      return res.status(403).send("💰 Daily spend limit exceeded.");
    }
  }

  // 4. Balance check (for sells)
  if (type === "sell") {
    const xrpBalance = await getKrakenXRPBalance();
    if (xrpBalance < parseFloat(amount)) {
      return res.status(403).send(`❌ Not enough XRP to sell. Available: ${xrpBalance}`);
    }
  }

  // Kraken market order
  const pair = `${coin}/USD`.toUpperCase();
  const nonce = Date.now() * 1000;
  const requestData = {
    nonce,
    pair,
    type,
    ordertype: "market",
    volume: amount,
  };
  const path = "/0/private/AddOrder";
  const signature = getKrakenSignature(path, requestData, API_SECRET, nonce);

  try {
    const response = await axios.post("https://api.kraken.com" + path, qs.stringify(requestData), {
      headers: {
        "API-Key": API_KEY,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const result = response.data;
    if (result.error && result.error.length) {
      throw new Error(result.error.join(", "));
    }

    lastTradeTime = now;
    if (type === "buy") logTodaySpend(amount);

    res.send("✅ Trade executed: " + JSON.stringify(result.result));
  } catch (err) {
    console.error("❌ Trade error:", err.message);
    res.status(500).send("Trade failed: " + err.message);
  }
});

app.listen(port, () => {
  console.log(`✅ Kraken bot running with risk controls on port ${port}`);
});
