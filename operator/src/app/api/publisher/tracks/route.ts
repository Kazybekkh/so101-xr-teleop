import { type NextRequest } from 'next/server';

/**
 * POST /api/publisher/tracks
 *
 * Called by the publisher AFTER the PeerConnection is connected.
 * Registers named tracks with Cloudflare so subscribers can find them.
 */

const CF_APP_ID = process.env.CLOUDFLARE_REALTIME_APP_ID;
const CF_TOKEN = process.env.CLOUDFLARE_REALTIME_TOKEN;
const CF_BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export async function POST(request: NextRequest) {
  if (!CF_APP_ID || !CF_TOKEN) {
    return Response.json({ error: 'CF not configured' }, { status: 503 });
  }

  const { publisherSessionId, tracks } = (await request.json()) as {
    publisherSessionId: string;
    tracks: Array<{ trackName: string; mid: string }>;
  };

  if (!publisherSessionId || !tracks?.length) {
    return Response.json({ error: 'Missing publisherSessionId or tracks' }, { status: 400 });
  }

  const res = await fetch(
    `${CF_BASE}/${CF_APP_ID}/sessions/${publisherSessionId}/tracks/new`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracks: tracks.map((t) => ({
          location: 'local',
          mid: t.mid,
          trackName: t.trackName,
        })),
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[publish/tracks] CF error:', err);
    return Response.json({ error: `CF track error: ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  console.log('[publish/tracks] Tracks registered');

  return Response.json({ ok: true, tracks: data.tracks });
}
