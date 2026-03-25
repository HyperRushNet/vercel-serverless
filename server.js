const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/convert', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is verplicht');

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup
        doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads").forEach(el => el.remove());
        
        const root = doc.querySelector("article, main") || doc.body;
        const markdown = nodeToMarkdown(root);

        res.send(markdown.replace(/\n{3,}/g, '\n\n').trim());
    } catch (err) {
        res.status(500).send("Error: " + err.message);
    } finally {
        if (browser) await browser.close();
    }
});

function nodeToMarkdown(node) {
    let md = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
            md += child.textContent.replace(/\s+/g, " ");
        } else if (child.nodeType === 1) {
            const tag = child.tagName.toLowerCase();
            const inner = nodeToMarkdown(child);
            switch(tag) {
                case "h1": md += `\n# ${inner}\n`; break;
                case "h2": md += `\n## ${inner}\n`; break;
                case "p": md += `\n${inner}\n`; break;
                case "a": md += ` [${inner.trim()}](${child.getAttribute('href') || '#'}) `; break;
                case "li": md += `\n- ${inner}`; break;
                default: md += inner;
            }
        }
    });
    return md;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
