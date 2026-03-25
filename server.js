const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();
app.use(cors());

let browser;

async function initBrowser() {
    try {
        browser = await puppeteer.launch({
            executablePath: puppeteer.executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            headless: "new"
        });
        browser.on('disconnected', initBrowser);
        console.log("🚀 Browser Ready");
    } catch (err) {
        setTimeout(initBrowser, 5000);
    }
}
initBrowser();

app.get('/convert', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL missing');
    if (!browser) return res.status(500).send('Browser starting...');

    let page = null;
    try {
        page = await browser.newPage();
        
        // Versnel laden door onnodige troep te blokkeren
        await page.setRequestInterception(true);
        page.on('request', (r) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(r.resourceType())) r.abort();
            else r.continue();
        });

        // Voor Poki moeten we soms even wachten tot de JS klaar is
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // 1. VERWIJDER DIRECTE TROEP
        const blacklist = "nav, footer, header, aside, script, style, iframe, .ads, #sidebar, .menu, [role='navigation']";
        doc.querySelectorAll(blacklist).forEach(el => el.remove());

        // 2. SLIM FILTEREN VAN SPELLEN-LIJSTEN (Jouw specifieke vraag)
        // We zoeken naar containers die te veel links bevatten (zoals die lange lijst spellen)
        const containers = doc.querySelectorAll('div, ul, section');
        containers.forEach(container => {
            const links = container.querySelectorAll('a');
            const textLength = container.textContent.length;
            
            // Als een blok meer dan 5 links heeft en de tekst bijna alleen maar uit link-titels bestaat: weg ermee.
            if (links.length > 5 && (links.length * 15) > textLength * 0.5) {
                container.remove();
            }
        });

        // 3. PAK DE HOOFDCONTENT
        // Bij Poki is de beschrijving vaak een specifieke div, anders pakken we de rest
        const mainContent = doc.querySelector('article, main, .game-description, #description') || doc.body;
        
        const markdown = nodeToMarkdown(mainContent);
        
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (err) {
        res.status(500).send(err.message);
    } finally {
        if (page) await page.close();
    }
});

function nodeToMarkdown(node) {
    let md = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
            const txt = child.textContent.replace(/\s+/g, " ");
            if (txt.length > 2) md += txt;
        } else if (child.nodeType === 1) {
            const tag = child.tagName.toLowerCase();
            const inner = nodeToMarkdown(child);
            if (!inner.trim() && tag !== "br") return;

            switch(tag) {
                case "h1": md += `\n# ${inner}\n`; break;
                case "h2": md += `\n## ${inner}\n`; break;
                case "p": md += `\n${inner}\n`; break;
                case "a": md += ` [${inner.trim()}](${child.getAttribute('href') || '#'}) `; break;
                case "li": md += `\n- ${inner}`; break;
                case "br": md += "\n"; break;
                default: md += inner;
            }
        }
    });
    return md;
}

app.listen(process.env.PORT || 3000);
