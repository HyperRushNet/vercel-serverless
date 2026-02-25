// Vercel CORS Proxy // GH: HyperRushNet | MIT License | 2026
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "No URL specified" });

    const body = ['POST','PUT','PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { ...req.headers, host: new URL(targetUrl).host },
      body,
    });

    response.headers.forEach((value, key) => res.setHeader(key, value));
    const buffer = await response.arrayBuffer();
    res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}
