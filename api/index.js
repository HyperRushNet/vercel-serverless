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

    const data = req.query.data;
    const type = req.query.type || "text/plain; charset=utf-8";

    if (!data) {
      res.status(400).send("No data parameter provided");
      return;
    }

    let output;

    if (type.startsWith("text/")) {
      // Verwacht '0'/'1' string voor tekst
      if (!/^[01]+$/.test(data) || data.length % 8 !== 0) {
        res.status(400).send("Invalid binary string");
        return;
      }
      // Splits in bytes van 8 bits
      let chars = [];
      for (let i = 0; i < data.length; i += 8) {
        let byte = data.slice(i, i + 8);
        chars.push(String.fromCharCode(parseInt(byte, 2)));
      }
      output = chars.join('');
    } else {
      // Voor andere content blijft base64
      output = Buffer.from(data, "base64");
    }

    res.setHeader("Content-Type", type);
    res.status(200).send(output);

  } catch (err) {
    res.status(500).send("Error decoding data: " + err.message);
  }
}
