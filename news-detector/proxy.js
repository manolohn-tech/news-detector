/**
 * VERIDECT — Vercel API Proxy
 * Place this file at: /api/proxy.js in your project root
 * 
 * This runs on Vercel's servers — your API key never touches the browser.
 */

export default async function handler(req, res) {
  // Allow your frontend to call this
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: { message: "Method not allowed" } });

  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({
      error: { message: "ANTHROPIC_API_KEY not set. Add it in Vercel → Settings → Environment Variables." }
    });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
}