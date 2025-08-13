export default function handler(req, res) {
  try {
    const encoded = req.query.data;
    if (!encoded) {
      res.status(400).send("No data parameter provided");
      return;
    }

    // Base64 decoderen
    const decoded = Buffer.from(encoded, "base64").toString("utf8");

    // Zet de juiste content-type zodat alles exact blijft staan
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(decoded);
  } catch (err) {
    res.status(500).send("Error decoding data: " + err.message);
  }
}
