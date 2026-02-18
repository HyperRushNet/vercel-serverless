// From: chat-app/api/mailAPI.js

/*
* HyperRush Network - GH: HyperRushNet
* MIT License - 2026
* api/mailAPI.js
*/

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Only POST allowed" });

  const GAS_URL = "https://script.google.com/macros/s/AKfycbyjjYmri3_TTlcRANHZLR-IghRbslxY2C-T7eJ7UzY2lPr7KN0Sv0HES7gKreT_IRcI/exec";

  try {
    const { email, code = "", action: bodyAction } = req.body;
    const path = req.url || "";
    const action = bodyAction || (path.includes('send') ? 'send' : path.includes('verify') ? 'verify' : null);

    if (!action || !email) {
      return res.status(400).json({ error: "Missing action or email", received: { action, email } });
    }

    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email, code })
    });

    const result = await response.json();
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
