const { put, list } = require('@vercel/blob');

const BLOB_KEY = 'hik-dashboard/entries.json';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Blob에서 데이터 읽기
  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: BLOB_KEY });
      if (!blobs.length) return res.status(200).json([]);
      const r = await fetch(blobs[0].url);
      if (!r.ok) return res.status(200).json([]);
      return res.status(200).json(await r.json());
    } catch (e) {
      console.error('GET error:', e);
      return res.status(200).json([]);
    }
  }

  // POST: Blob에 데이터 저장
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!Array.isArray(body)) return res.status(400).json({ error: 'body must be array' });
      await put(BLOB_KEY, JSON.stringify(body), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('POST error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
};
