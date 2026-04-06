export default async function handler(req, res) {
    const SOURCE_URL = "https://un-zynq.github.io/games2.json";
    const CDN_URL = "https://cdn.jsdelivr.net/gh/un-zynq/splash-images";

    try {
        // 1. Fetch the raw data from GitHub
        const response = await fetch(SOURCE_URL);
        if (!response.ok) throw new Error("Failed to fetch source JSON");
        const shards = await response.json();

        // 2. Parse and flatten the data (Server-side equivalent of your SDK)
        let allGames = [];
        shards.forEach(shard => {
            Object.entries(shard).forEach(([group, games]) => {
                Object.entries(games).forEach(([key, info]) => {
                    const { rank, ...cleanInfo } = info;
                    allGames.push({
                        ...cleanInfo,
                        alias: key,
                        url: `${group}/${key}`,
                        splash: `${CDN_URL}/${group}/${key}.webp`
                    });
                });
            });
        });

        // 3. Universal Sort (A-Z)
        allGames.sort((a, b) => a.name.localeCompare(b.name));

        // 4. Handle API Queries
        const { q, alias, type, n } = req.query;

        if (alias) {
            const game = allGames.find(g => g.alias === alias);
            return game ? res.json(game) : res.status(404).json({ error: "Not Found" });
        }

        if (type === 'random') {
            const count = Math.min(parseInt(n) || 1, allGames.length);
            const shuffled = [...allGames].sort(() => 0.5 - Math.random());
            return res.json(count === 1 ? shuffled[0] : shuffled.slice(0, count));
        }

        if (q) {
            const searchTerm = q.toLowerCase();
            const results = allGames.filter(g => 
                g.name.toLowerCase().includes(searchTerm) || 
                g.alias.toLowerCase().includes(searchTerm)
            );
            return res.json(results);
        }

        // Return all by default
        return res.status(200).json(allGames);

    } catch (error) {
        return res.status(500).json({ error: "Server Error", message: error.message });
    }
}
