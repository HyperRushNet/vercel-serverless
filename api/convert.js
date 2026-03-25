const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { JSDOM } = require('jsdom');

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is verplicht' });

    let browser = null;

    try {
        // Chromium optimalisaties voor Vercel
        chromium.setGraphicsMode = false;

        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Gebruik een User-Agent om blokkades te voorkomen
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Navigeer en wacht tot JS klaar is (max 8s voor Vercel Hobby)
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 8000 });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Slimme cleanup van de DOM
        const trash = doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads, noscript, svg");
        trash.forEach(el => el.remove());

        const root = doc.querySelector("article, main, .content, #content") || doc.body;
        const markdown = nodeToMarkdown(root);

        // Resultaat terugsturen
        res.status(200).send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (error) {
        console.error("Deployment Error:", error.message);
        res.status(500).json({ error: "Browser crash of timeout. " + error.message });
    } finally {
        if (browser) await browser.close();
    }
}

function nodeToMarkdown(node) {
    let md = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) { // Text node
            md += child.textContent.replace(/\s+/g, " ");
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
                    const href = child.getAttribute("href");
                    md += (href && inner) ? ` [${inner.trim()}](${href}) ` : inner; 
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
