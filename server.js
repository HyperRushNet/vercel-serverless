const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const TurndownService = require('turndown');
const cors = require('cors');

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());

// --- CONFIG ---
const DEFAULT_TTL = 60 * 60 * 1000; // Standaard 1 uur
const cache = new Map();

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

let browser;
let isInitializing = false;

async function initBrowser() {
    if (isInitializing || (browser && browser.connected)) return;
    isInitializing = true;
    try {
        browser = await puppeteer.launch({
            executablePath: require('puppeteer').executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
            headless: "new"
        });
        browser.on('disconnected', initBrowser);
        console.log("✅ Browser Ready");
    } catch (err) {
        isInitializing = false;
        setTimeout(initBrowser, 3000);
    }
}
initBrowser();

app.get('/convert', async (req, res) => {
    const { url, nocache, ttl } = req.query; // Pak de parameters uit de URL
    if (!url) return res.status(400).send('URL missing');

    const useCache = nocache !== 'true'; // Als ?nocache=true, dan negeren we de cache
    const customTTL = ttl ? parseInt(ttl) * 1000 : DEFAULT_TTL;

    // 1. CACHE CHECK (Alleen als nocache niet waar is)
    if (useCache && cache.has(url)) {
        const cachedData = cache.get(url);
        if (Date.now() - cachedData.timestamp < cachedData.ttl) {
            console.log(`🎯 Cache Hit: ${url}`);
            res.set('X-Cache', 'HIT');
            return res.status(200).type('text/plain').send(cachedData.markdown);
        }
        cache.delete(url);
    }

    if (!browser) return res.status(503).send('Browser starting, try again...');

    let page = null;
    try {
        console.log(`🚀 Fetching: ${url} (Cache: ${useCache})`);
        page = await browser.newPage();
        
        // Snelheid: blokkeer onnodige meuk
        await page.setRequestInterception(true);
        page.on('request', (r) => {
            if (['image', 'stylesheet', 'font', 'media', 'other'].includes(r.resourceType())) r.abort();
            else r.continue();
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // Ga naar de site (geen timeout limiet)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });
        
        // Wacht heel even voor eventuele Cloudflare JS/Redirects
        await new Promise(r => setTimeout(r, 600));

        const data = await page.evaluate(() => {
            const drop = "nav, footer, header, aside, script, style, .ads, #cookie-banner, .menu, .sidebar";
            document.querySelectorAll(drop).forEach(el => el.remove());
            const main = document.querySelector('article, main, #content, .mw-parser-output, .article-body') || document.body;
            return { html: main.innerHTML, title: document.title };
        });

        const markdown = `# ${data.title}\n\n${turndownService.turndown(data.html)}`.trim();

        // 2. OPSLAAN IN CACHE (Als we cache mogen gebruiken)
        if (useCache) {
            cache.set(url, {
                markdown,
                timestamp: Date.now(),
                ttl: customTTL
            });
            // Cache cleanup (max 100 items)
            if (cache.size > 100) cache.delete(cache.keys().next().value);
        }

        res.set('X-Cache', 'MISS');
        res.status(200).type('text/plain').send(markdown);

    } catch (err) {
        res.status(500).send("Fout: " + err.message);
    } finally {
        if (page) await page.close();
    }
});

app.listen(process.env.PORT || 3000);
