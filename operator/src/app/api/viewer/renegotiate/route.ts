import { type NextRequest } from 'next/server';

/**
 * POST /api/viewer/renegotiate
 *
 * Called by the viewer if Cloudflare returned requiresImmediateRenegotiation.
 * Sends a fresh offer to CF and returns the new answer.
 */

const CF_APP_ID = process.env.CLOUDFLARE_REALTIME_APP_ID;
const CF_TOKEN  = process.env.CLOUDFLARE_REALTIME_TOKEN;
const CF_BASE   = 'https://rtc.live.cloudflare.com/v1/apps';

export async function POST(request: NextRequest) {
  if (!CF_APP_ID || !CF_TOKEN) {
    return Response.json({ error: 'CF not configured' }, { status: 503 });
  }

  const { viewerSessionId, offerSdp, offerType } = await request.json();

  const res = await fetch(
    `${CF_BASE}/${CF_APP_ID}/sessions/${viewerSessionId}/renegotiate`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionDescription: { type: offerType, sdp: offerSdp },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[renegotiate] CF error:', res.status, err);
    return Response.json({ error: `CF renegotiate error: ${res.status} ${err}` }, { status: 502 });
  }

  console.log('[renegotiate] Answer accepted by CF');
  return Response.json({ ok: true });
}
