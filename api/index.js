export default function handler(req, res) {
  try {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // OPTIONS request (CORS preflight)
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    const encoded = req.query.data;
    if (!encoded) {
      res.status(400).send("No data parameter provided");
      return;
    }

    // Base64 decoderen
    const decoded = Buffer.from(encoded, "base64").toString("utf8");

    // Zet text/plain zodat spacing en indents exact blijven
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(decoded);

  } catch (err) {
    res.status(500).send("Error decoding data: " + err.message);
  }
}
