const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { JSDOM } = require('jsdom');

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is verplicht' });

    let browser = null;

    try {
        // Configuratie voor Vercel/Serverless
        browser = await puppeteer.launch({
            args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Wacht tot de site (incl. JS) geladen is
        await page.goto(url, { 
            waitUntil: 'networkidle0', 
            timeout: 9000 // Blijf onder de 10s limiet van Vercel Hobby
        });

        const html = await page.content();
        
        // Server-side parsing met JSDOM
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup rommel
        doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads, noscript").forEach(el => el.remove());

        const root = doc.querySelector("article, main") || doc.body;
        const markdown = nodeToMarkdown(root);

        res.status(200).send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
}

function nodeToMarkdown(node) {
    let text = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) { // Text Node
            text += child.textContent.replace(/\s+/g, " ");
        } else if (child.nodeType === 1) { // Element Node
            const tag = child.tagName.toLowerCase();
            const inner = nodeToMarkdown(child);

            switch(tag) {
                case "h1": text += `\n# ${inner}\n`; break;
                case "h2": text += `\n## ${inner}\n`; break;
                case "h3": text += `\n### ${inner}\n`; break;
                case "p": case "div": text += `\n${inner}\n`; break;
                case "strong": case "b": text += `**${inner}**`; break;
                case "em": case "i": text += `*${inner}*`; break;
                case "a": 
                    const href = child.getAttribute("href");
                    text += (href && inner) ? `[${inner.trim()}](${href})` : inner;
                    break;
                case "li": text += `\n- ${inner}`; break;
                case "ul": case "ol": text += `\n${inner}\n`; break;
                case "br": text += "\n"; break;
                case "pre": text += `\n\`\`\`\n${child.textContent.trim()}\n\`\`\`\n`; break;
                case "code": text += ` \`${inner}\` `; break;
                default: text += inner;
            }
        }
    });
    return text;
}
