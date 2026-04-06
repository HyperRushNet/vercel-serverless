import hrn from '../dev/lib7.4.js';

export default async function handler(req, res) {
    try {
        // 1. Initialize and load the data
        await hrn.load();

        // 2. Get the query parameters
        const { q, alias, type, n } = req.query;

        // 3. Logic based on request type
        if (alias) {
            const game = hrn.get(alias);
            if (!game) return res.status(404).json({ error: "Game not found" });
            return res.status(200).json(game);
        }

        if (type === 'random') {
            const count = parseInt(n) || 1;
            return res.status(200).json(hrn.random(count));
        }

        if (q) {
            const results = hrn.search(q);
            return res.status(200).json(results);
        }

        // Default: Return all games
        return res.status(200).json(hrn.all());

    } catch (error) {
        return res.status(500).json({ 
            error: "Internal Server Error", 
            details: error.message 
        });
    }
}
