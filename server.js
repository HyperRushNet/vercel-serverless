const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const TurndownService = require('turndown');
const cors = require('cors');

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());

// Turndown configureren voor de beste Markdown
const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---'
});

let browser;

// Browser één keer opstarten en warm houden
async function initBrowser() {
    browser = await puppeteer.launch({
        executablePath: require('puppeteer').executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--no-zygote'
        ],
        headless: "new"
    });
    console.log("🚀 Ultra-Stealth Browser is online");
}
initBrowser();

app.get('/convert', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL missing');

    let page = null;
    try {
        page = await browser.newPage();
        
        // Snelheidsboost: Blokkeer onnodige resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Gebruikers-simulatie (tegen Cloudflare)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // Navigeer snel
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', // Sneller dan networkidle
            timeout: 20000 
        });

        // Wacht specifiek op content als Cloudflare een challenge geeft
        await new Promise(r => setTimeout(r, 1000)); 

        const content = await page.evaluate(() => {
            // Verwijder rommel direct in de browser (sneller dan JSDOM)
            const drop = "nav, footer, header, aside, script, style, .ads, #cookie-banner, .menu";
            document.querySelectorAll(drop).forEach(el => el.remove());
            
            // Pak de "Main" content of de body
            const main = document.querySelector('article, main, #content, .post-body, .article-content') || document.body;
            return main.innerHTML;
        });

        // Zet HTML om naar perfecte Markdown via Turndown
        const markdown = turndownService.turndown(content);

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(markdown.trim());

    } catch (err) {
        res.status(500).send("Fout: " + err.message);
    } finally {
        if (page) await page.close();
    }
});

app.listen(process.env.PORT || 3000);
