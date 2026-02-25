export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "No URL specified" });

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { 'User-Agent': 'Vercel-CORS-Proxy' },
      body: ['POST','PUT','PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding') res.setHeader(key, value);
    });

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}
