import { type NextRequest } from 'next/server';

/**
 * POST /api/viewer/tracks
 *
 * Called by the viewer AFTER the PeerConnection is connected.
 * Subscribes to the publisher's track so media starts flowing.
 */

const CF_APP_ID = process.env.CLOUDFLARE_REALTIME_APP_ID;
const CF_TOKEN = process.env.CLOUDFLARE_REALTIME_TOKEN;
const CF_BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export async function POST(request: NextRequest) {
  if (!CF_APP_ID || !CF_TOKEN) {
    return Response.json({ error: 'CF not configured' }, { status: 503 });
  }

  const { viewerSessionId, publisherSessionId, trackName } = (await request.json()) as {
    viewerSessionId: string;
    publisherSessionId: string;
    trackName: string;
  };

  if (!viewerSessionId || !publisherSessionId) {
    return Response.json({ error: 'Missing viewerSessionId or publisherSessionId' }, { status: 400 });
  }

  const res = await fetch(
    `${CF_BASE}/${CF_APP_ID}/sessions/${viewerSessionId}/tracks/new`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracks: [
          {
            location: 'remote',
            trackName: trackName ?? 'robot-camera',
            sessionId: publisherSessionId,
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[viewer/tracks] CF error:', err);
    return Response.json({ error: `CF track error: ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  console.log('[viewer/tracks] Subscribed, requiresRenegotiation:', data.requiresImmediateRenegotiation);

  return Response.json({
    requiresImmediateRenegotiation: data.requiresImmediateRenegotiation ?? false,
    sessionDescription: data.sessionDescription ?? null,
  });
}
