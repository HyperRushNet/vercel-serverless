// From: chat-app/api/mailAPI.js (v1.0.2)

/*
 * HyperRush Network - GH: HyperRushNet
 * MIT License - 2026
 * api/mailAPI.js
 * 
 * Environment Variables needed in Vercel:
 * - FRONTEND_URL: Your site domain (e.g. https://hrn.chat). Leave empty for '*' (public).
 * - GAS_URL: (Optional) Google Apps Script Web App URL.
 */

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_SEND_REQUESTS = 1;

export default async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const GAS_URL = process.env.GAS_URL || "https://script.google.com/macros/s/AKfycbyjjYmri3_TTlcRANHZLR-IghRbslxY2C-T7eJ7UzY2lPr7KN0Sv0HES7gKreT_IRcI/exec";

  try {
    const { email, code = "", action } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: "Email required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });
    if (!action || !['send', 'verify'].includes(action)) return res.status(400).json({ error: "Invalid action" });

    const now = Date.now();
    const normalizedEmail = email.toLowerCase();
    const userRecord = rateLimitStore.get(normalizedEmail);

    if (action === 'send') {
      if (userRecord) {
        if (now - userRecord.startTime > RATE_LIMIT_WINDOW_MS) {
          userRecord.count = 1;
          userRecord.startTime = now;
        } else {
          userRecord.count++;
        }
        if (userRecord.count > MAX_SEND_REQUESTS) {
          const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - userRecord.startTime)) / 1000);
          res.setHeader('Retry-After', retryAfter.toString());
          return res.status(429).json({ error: "Too many requests. Wait a moment." });
        }
      } else {
        rateLimitStore.set(normalizedEmail, { count: 1, startTime: now });
      }
    }

    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email: normalizedEmail, code })
    });

    const result = await response.json();
    return res.status(200).json(result);

  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
