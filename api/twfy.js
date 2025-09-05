// api/twfy.js - Secure API proxy for TheyWorkForYou
// This keeps your API key secret on the server

export default async function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get API key from server environment variables (secure)
    const API_KEY = process.env.TWFY_API_KEY;
    
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    // Extract parameters from query string
    const { endpoint, ...params } = req.query;
    
    // Whitelist allowed endpoints for security
    const allowedEndpoints = [
        'getMP',
        'getMPs', 
        'getDebates',
        'getWrans',
        'getWMS',
        'getCommittees'
    ];

    if (!allowedEndpoints.includes(endpoint)) {
        return res.status(400).json({ error: 'Invalid endpoint' });
    }

    try {
        // Build the TWFY API URL
        const twfyUrl = new URL(`https://www.theyworkforyou.com/api/${endpoint}`);
        
        // Add API key
        twfyUrl.searchParams.set('key', API_KEY);
        twfyUrl.searchParams.set('output', 'json');
        
        // Add other parameters
        Object.entries(params).forEach(([key, value]) => {
            if (value) {
                twfyUrl.searchParams.set(key, value);
            }
        });

        console.log('Fetching from TWFY:', twfyUrl.toString().replace(API_KEY, 'HIDDEN'));

        // Make request to TWFY API
        const response = await fetch(twfyUrl.toString());
        
        if (!response.ok) {
            throw new Error(`TWFY API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Cache for 5 minutes to avoid hitting API limits
        res.setHeader('Cache-Control', 's-maxage=300');

        return res.status(200).json(data);

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            error: 'Failed to fetch data from TheyWorkForYou',
            details: error.message 
        });
    }
}
