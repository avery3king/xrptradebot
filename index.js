const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const qs = require("qs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;

function getKrakenSignature(path, requestData, secret, nonce) {
  const message = qs.stringify(requestData);
  const secretBuffer = Buffer.from(secret, 'base64');
  const hash = crypto.createHash('sha256');
  const hmac = crypto.createHmac('sha512', secretBuffer);
  const hash_digest = hash.update(nonce + message).digest();
  const hmac_digest = hmac.update(path + hash_digest).digest('base64');
  return hmac_digest;
}

app.get("/trade", async (req, res) => {
  const { coin = "XRP", amount = "100", type = "buy" } = req.query;

  const pair = `${coin}/USD`.toUpperCase();
  const nonce = Date.now() * 1000;

  const requestData = {
    nonce,
    pair,
    type: type.toLowerCase(), // 'buy' or 'sell'
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
      console.error("❌ Kraken Error:", result.error);
      return res.status(500).send("❌ Kraken Error: " + result.error.join(", "));
    }

    console.log("✅ Order placed:", result.result);
    res.send("✅ Trade placed: " + JSON.stringify(result.result));
  } catch (error) {
    console.error("❌ Request failed:", error.response?.data || error.message);
    res.status(500).send("❌ Request failed: " + error.message);
  }
});

app.listen(port, () => {
  console.log(`✅ Kraken bot running on port ${port}`);
});
