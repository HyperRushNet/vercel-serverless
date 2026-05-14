export default async function handler(req, res) {
    // Alleen GET requests toestaan
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Valideer of het een GitHub ZIP url is
    if (!url.includes('github.com') || !url.endsWith('.zip')) {
        return res.status(400).json({ error: 'Invalid URL - only GitHub ZIP files allowed' });
    }

    try {
        // Download het bestand van GitHub
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'CORS-Proxy/1.0',
                'Accept': 'application/zip'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ 
                error: `GitHub returned ${response.status}: ${response.statusText}` 
            });
        }

        // Check content type
        const contentType = response.headers.get('content-type');
        const isZip = contentType?.includes('application/zip') || 
                      contentType?.includes('application/octet-stream') ||
                      url.endsWith('.zip');

        if (!isZip) {
            return res.status(400).json({ error: 'Response is not a ZIP file' });
        }

        // Haal de blob op
        const buffer = await response.arrayBuffer();
        
        // Stuur de response met correcte headers
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Content-Length', buffer.byteLength);
        
        // Optioneel: originele bestandsnaam behouden
        const filename = url.split('/').pop();
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Stuur de data
        res.status(200).send(Buffer.from(buffer));
        
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}

// OPTIONS handler voor CORS preflight
export async function OPTIONS(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
}
