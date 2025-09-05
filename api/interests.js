// /api/interests.js  — Vercel serverless function acting as a CORS proxy
export default async function handler(req, res) {
  // Build upstream URL and forward query params
  const upstream = new URL("https://interests-api.parliament.uk/api/v1/Interests");
  for (const [k, v] of Object.entries(req.query || {})) {
    upstream.searchParams.set(k, String(v));
  }

  // Fetch from the Interests API
  const r = await fetch(upstream.toString(), {
    headers: { Accept: "application/json" },
  });

  const text = await r.text();

  // Return same status + body, but add CORS headers
  res
    .status(r.status)
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET,OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "*")
    .setHeader("Content-Type", r.headers.get("content-type") || "application/json")
    .send(text);
}

// Optional: handle preflight locally if Vercel calls this with OPTIONS
export const config = {
  api: { bodyParser: false },
};
