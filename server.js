const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();
app.use(cors());

let browser; // We houden de browser hier vast in het geheugen

/**
 * Functie om de browser te starten (en automatisch te herstarten bij crash)
 */
async function initBrowser() {
    try {
        console.log("🚀 Browser opstarten...");
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
        
        browser.on('disconnected', initBrowser); // Herstart als Chrome crasht
        console.log("✅ Browser is online en klaar voor gebruik.");
    } catch (err) {
        console.error("❌ Fout bij opstarten browser:", err.message);
        setTimeout(initBrowser, 5000); // Probeer het over 5 sec opnieuw
    }
}

// Start de browser direct bij het opstarten van de server
initBrowser();

app.get('/convert', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL ontbreekt');

    if (!browser) return res.status(500).send('Browser is nog aan het opstarten, probeer het over 2 seconden.');

    let page = null;
    try {
        const start = Date.now(); // Voor snelheidstesten in de console

        page = await browser.newPage(); // Open een tabblad, niet een hele browser
        
        // Blokkeer afbeeldingen en CSS om het laden NOG sneller te maken
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup
        doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads, noscript").forEach(el => el.remove());
        const root = doc.querySelector("article, main") || doc.body;
        
        const markdown = nodeToMarkdown(root);
        const duration = Date.now() - start;
        
        console.log(`⚡ Conversie klaar in ${duration}ms voor ${url}`);
        
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (err) {
        res.status(500).send("Error: " + err.message);
    } finally {
        if (page) await page.close(); // Sluit alleen het tabblad, niet de browser!
    }
});

// Eenvoudige parser (zoals voorheen)
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
                case "br": md += "\n"; break;
                default: md += inner;
            }
        }
    });
    return md;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server op poort ${PORT}`));
