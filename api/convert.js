const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { JSDOM } = require('jsdom');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is verplicht' });

    let browser = null;

    try {
        // ESSENTIEEL: Schakel graphics uit om systeem-libs te omzeilen
        chromium.setGraphicsMode = false;

        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process',
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Timeout naar 9s (Vercel Hobby limiet is 10s)
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 9000 });
        
        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup
        doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, noscript").forEach(el => el.remove());
        const root = doc.querySelector("article, main") || doc.body;
        
        const markdown = nodeToMarkdown(root);
        res.status(200).send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (error) {
        // Specifieke error logging voor Vercel dashboard
        console.error("Puppeteer Launch Error:", error.message);
        res.status(500).json({ error: "Browser error: " + error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

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
                case "p": case "div": md += `\n${inner}\n`; break;
                case "strong": case "b": md += `**${inner}**`; break;
                case "a": md += ` [${inner.trim()}](${child.getAttribute('href') || '#'}) `; break;
                case "li": md += `\n- ${inner}`; break;
                case "pre": md += `\n\`\`\`\n${child.textContent.trim()}\n\`\`\`\n`; break;
                case "br": md += "\n"; break;
                default: md += inner;
            }
        }
    });
    return md;
}
