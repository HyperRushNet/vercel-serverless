const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { JSDOM } = require('jsdom');

export default async function handler(req, res) {
  // 1. CORS Headers instellen
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is verplicht' });

  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    
    // Haal de gerenderde HTML op van de volledige pagina
    const html = await page.content();
    
    // 2. Parsen op de server met JSDOM
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Cleanup rommel
    const trash = doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads");
    trash.forEach(el => el.remove());

    const root = doc.querySelector("article, main") || doc.body;
    
    // 3. Omzetten naar Markdown (Server-side)
    const markdown = nodeToMarkdown(root);

    res.status(200).send(markdown.replace(/\n{3,}/g, '\n\n').trim());

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
}

// De parser functie (nu binnen de backend context)
function nodeToMarkdown(node) {
  let text = "";
  node.childNodes.forEach(child => {
    if (child.nodeType === 3) { // Text Node
      text += child.textContent.replace(/\s+/g, " ");
    } else if (child.nodeType === 1) { // Element Node
      const tag = child.tagName.toLowerCase();
      const inner = nodeToMarkdown(child);

      switch(tag) {
        case "h1": text += `\n# ${inner}\n`; break;
        case "h2": text += `\n## ${inner}\n`; break;
        case "h3": text += `\n### ${inner}\n`; break;
        case "p": text += `\n${inner}\n`; break;
        case "strong": case "b": text += `**${inner}**`; break;
        case "em": case "i": text += `*${inner}*`; break;
        case "a": text += `[${inner.trim()}](${child.getAttribute('href') || '#'})`; break;
        case "li": text += `\n- ${inner}`; break;
        case "br": text += "\n"; break;
        case "pre": text += `\n\`\`\`\n${child.textContent.trim()}\n\`\`\`\n`; break;
        default: text += inner;
      }
    }
  });
  return text;
}
