const chromium = require('@sparticuz/chromium-min');
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
        // Dit downloadt de ontbrekende libraries (libnss3 etc) naar de /tmp map van Vercel
        const executablePath = await chromium.executablePath(
            'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar'
        );

        browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
        
        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup
        doc.querySelectorAll("script, style, nav, footer, header, aside, iframe").forEach(el => el.remove());
        const root = doc.querySelector("article, main") || doc.body;
        
        const markdown = nodeToMarkdown(root);
        res.status(200).send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (error) {
        res.status(500).json({ error: "FIX: " + error.message });
    } finally {
        if (browser) await browser.close();
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
                case "p": md += `\n${inner}\n`; break;
                case "a": md += ` [${inner.trim()}](${child.getAttribute('href') || '#'}) `; break;
                case "li": md += `\n- ${inner}`; break;
                default: md += inner;
            }
        }
    });
    return md;
}
