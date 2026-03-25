const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { JSDOM } = require('jsdom');

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is verplicht' });

    let browser = null;

    try {
        // Belangrijk voor Vercel: Graphics mode uitzetten om lib-errors te voorkomen
        chromium.setGraphicsMode = false;

        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--hide-scrollbars',
                '--disable-web-security',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Timeout strak op 8s om Vercel's 10s limiet niet te triggeren
        await page.goto(url, { 
            waitUntil: 'networkidle0', 
            timeout: 8000 
        });

        const html = await page.content();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Cleanup
        doc.querySelectorAll("script, style, nav, footer, header, aside, iframe, .ads, noscript").forEach(el => el.remove());

        const root = doc.querySelector("article, main") || doc.body;
        const markdown = nodeToMarkdown(root);

        res.status(200).send(markdown.replace(/\n{3,}/g, '\n\n').trim());

    } catch (error) {
        console.error("Browser Error:", error);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
}

function nodeToMarkdown(node) {
    let text = "";
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
            text += child.textContent.replace(/\s+/g, " ");
        } else if (child.nodeType === 1) {
            const tag = child.tagName.toLowerCase();
            const inner = nodeToMarkdown(child);
            switch(tag) {
                case "h1": text += `\n# ${inner}\n`; break;
                case "h2": text += `\n## ${inner}\n`; break;
                case "h3": text += `\n### ${inner}\n`; break;
                case "p": case "div": text += `\n${inner}\n`; break;
                case "strong": case "b": text += `**${inner}**`; break;
                case "em": case "i": text += `*${inner}*`; break;
                case "a": text += ` [${inner.trim()}](${child.getAttribute('href') || '#'}) `; break;
                case "li": text += `\n- ${inner}`; break;
                case "ul": case "ol": text += `\n${inner}\n`; break;
                case "pre": text += `\n\`\`\`\n${child.textContent.trim()}\n\`\`\`\n`; break;
                case "code": text += ` \`${inner}\` `; break;
                case "br": text += "\n"; break;
                default: text += inner;
            }
        }
    });
    return text;
}
