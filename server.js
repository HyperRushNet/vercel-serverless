const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

/**
 * 1. Root Endpoint - Handig om te zien of de server leeft
 */
app.get('/', (req, res) => {
    res.send(`
        <h1>HTML to Markdown API is Online</h1>
        <p>Gebruik: <code>/convert?url=https://voorbeeld.nl</code></p>
        <p>Debug: <a href="/debug">/debug</a></p>
    `);
});

/**
 * 2. Debug Endpoint - Om te controleren of de browser echt geïnstalleerd is
 */
app.get('/debug', async (req, res) => {
    try {
        const browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const version = await browser.version();
        await browser.close();
        res.json({
            status: "success",
            puppeteer_version: require('puppeteer/package.json').version,
            browser_version: version,
            node_version: process.version,
            cache_path: puppeteer.configuration?.cacheDirectory || "default"
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

/**
 * 3. Conversie Endpoint - De kern logica
 */
app.get('/convert', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('Fout: Geen URL opgegeven. Gebruik ?url=https://...');
    }

    let browser = null;
    try {
        console.log(`--- Start conversie voor: ${url} ---`);

        // Launch browser met de lokale cache instellingen
        browser = await puppeteer.launch({
            executablePath: puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote'
            ],
            headless: "new"
        });

        const page = await browser.newPage();
        
        // Voorkom bot-detectie
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Wacht tot de pagina geladen is (max 30s)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup: Verwijder onnodige elementen
        const trash = doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads, ins, noscript, svg, form, button");
        trash.forEach(el => el.remove());
        
        // Selecteer hoofdcontent of de body
        const root = doc.querySelector("article, main, #content, .post-content, .article-body") || doc.body;
        
        const markdown = nodeToMarkdown(root);

        // Resultaat opschonen (geen 4 lege regels achter elkaar)
        const finalMarkdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

        console.log(`--- Conversie geslaagd voor: ${url} ---`);
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(finalMarkdown);

    } catch (err) {
        console.error("ERROR tijdens conversie:", err.message);
        res.status(500).send("Conversie mislukt: " + err.message);
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser gesloten.");
        }
    }
});

/**
 * Recursieve Parser Functie
 */
function nodeToMarkdown(node) {
    let md = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) { // Text node
            const text = child.textContent.replace(/\s+/g, " ");
            if (text !== " ") md += text;
        } else if (child.nodeType === 1) { // Element node
            const tag = child.tagName.toLowerCase();
            const inner = nodeToMarkdown(child);

            switch(tag) {
                case "h1": md += `\n# ${inner}\n`; break;
                case "h2": md += `\n## ${inner}\n`; break;
                case "h3": md += `\n### ${inner}\n`; break;
                case "p": case "div": md += `\n${inner}\n`; break;
                case "strong": case "b": md += `**${inner}**`; break;
                case "em": case "i": md += `*${inner}*`; break;
                case "a": 
                    const href = child.getAttribute('href');
                    md += (href && inner.trim()) ? ` [${inner.trim()}](${href}) ` : inner; 
                    break;
                case "li": md += `\n- ${inner}`; break;
                case "ul": case "ol": md += `\n${inner}\n`; break;
                case "br": md += "\n"; break;
                case "pre": md += `\n\`\`\`\n${child.textContent.trim()}\n\`\`\`\n`; break;
                case "code": md += ` \`${inner}\` `; break;
                case "img":
                    const alt = child.getAttribute('alt') || 'image';
                    const src = child.getAttribute('src');
                    if (src) md += `\n![${alt}](${src})\n`;
                    break;
                default: md += inner;
            }
        }
    });
    return md;
}

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    *****************************************
    🚀 Server draait op poort ${PORT}
    🔗 Endpoint: http://localhost:${PORT}/convert
    *****************************************
    `);
});
