import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL is not set' });
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const ext = await client.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
    const version = await client.query("SHOW server_version");
    const hasVector = ext.rowCount > 0;
    const serverVersion = version.rows?.[0]?.server_version || 'unknown';

    return res.status(200).json({
      ok: true,
      pgvector_enabled: hasVector,
      server_version: serverVersion,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    try { await client.end(); } catch {}
  }
}