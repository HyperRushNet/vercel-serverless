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
    const type = req.query.type || "text/plain; charset=utf-8";

    if (!encoded) {
      res.status(400).send("No data parameter provided");
      return;
    }

    // Base64 naar buffer
    const buffer = Buffer.from(encoded, "base64");

    // Voor tekst: naar UTF-8 string (emoji-proof)
    if (type.startsWith("text/") || type.includes("json")) {
      res.setHeader("Content-Type", type);
      res.status(200).send(buffer.toString("utf8"));
    } else {
      // Voor binaire content direct sturen
      res.setHeader("Content-Type", type);
      res.status(200).send(buffer);
    }

  } catch (err) {
    res.status(500).send("Error decoding data: " + err.message);
  }
}
