const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/convert', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Fout: Geen URL opgegeven. Gebruik ?url=https://...');

    let browser;
    try {
        console.log(`Lanceren browser voor: ${url}`);
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            headless: "new"
        });

        const page = await browser.newPage();
        
        // Stel een User-Agent in om basic bot-blocking te omzeilen
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Wacht tot de pagina echt klaar is (networkidle2 is stabieler voor Render)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup: Verwijder alle onnodige elementen voor een schone Markdown
        const trash = doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads, ins, noscript, svg");
        trash.forEach(el => el.remove());
        
        // Probeer de hoofdcontent te vinden, anders pakken we de body
        const root = doc.querySelector("article, main, #content, .post-content") || doc.body;
        const markdown = nodeToMarkdown(root);

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (err) {
        console.error("Server Error:", err.message);
        res.status(500).send("Conversie mislukt: " + err.message);
    } finally {
        if (browser) await browser.close();
    }
});

// De verbeterde recursieve parser
function nodeToMarkdown(node) {
    let md = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) { // Text node
            const cleanText = child.textContent.replace(/\s+/g, " ");
            if (cleanText !== " ") md += cleanText;
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
                default: md += inner;
            }
        }
    });
    return md;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Converter draait op poort ${PORT}`));
