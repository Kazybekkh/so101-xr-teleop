import { type NextRequest } from 'next/server';

/**
 * POST /api/viewer/subscribe
 *
 * Server-side signaling for the viewer (Side B).
 * Creates a new Cloudflare Realtime session for the viewer,
 * then subscribes it to the broadcaster's track.
 *
 * Request body:
 *   {
 *     publisherSessionId: string,  // from the broadcaster's output
 *     trackName: string,           // "robot-camera" by default
 *     offerSdp: string,            // from the browser's RTCPeerConnection
 *     offerType: string,           // "offer"
 *   }
 *
 * Response:
 *   {
 *     type: "answer",
 *     sdp: string,
 *     viewerSessionId: string,     // needed if renegotiation is required
 *     requiresImmediateRenegotiation: boolean,
 *   }
 */

const CF_APP_ID = process.env.CLOUDFLARE_REALTIME_APP_ID;
const CF_TOKEN  = process.env.CLOUDFLARE_REALTIME_TOKEN;
const CF_BASE   = 'https://rtc.live.cloudflare.com/v1/apps';

function cfHeaders() {
  return {
    'Authorization': `Bearer ${CF_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function POST(request: NextRequest) {
  if (!CF_APP_ID || !CF_TOKEN) {
    return Response.json(
      { error: 'Cloudflare Realtime not configured. Set CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_TOKEN in .env.local' },
      { status: 503 }
    );
  }

  let body: {
    publisherSessionId: string;
    trackName: string;
    offerSdp: string;
    offerType: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { publisherSessionId, offerSdp, offerType } = body;

  if (!publisherSessionId || !offerSdp) {
    return Response.json(
      { error: 'Missing required fields: publisherSessionId, offerSdp' },
      { status: 400 }
    );
  }

  try {
    // Create the CF session with the SDP offer.
    // Track subscription happens in a second request from the browser
    // after the PeerConnection is connected (POST /api/viewer/tracks).
    const sessionRes = await fetch(`${CF_BASE}/${CF_APP_ID}/sessions/new`, {
      method: 'POST',
      headers: cfHeaders(),
      body: JSON.stringify({
        sessionDescription: { type: offerType, sdp: offerSdp },
      }),
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      console.error('[subscribe] CF create session error:', err);
      return Response.json({ error: `CF session error: ${sessionRes.status}` }, { status: 502 });
    }

    const sessionData = await sessionRes.json() as {
      sessionId: string;
      sessionDescription: { type: string; sdp: string };
    };
    console.log('[subscribe] Viewer session created:', sessionData.sessionId);

    return Response.json({
      type: sessionData.sessionDescription.type,
      sdp: sessionData.sessionDescription.sdp,
      viewerSessionId: sessionData.sessionId,
    });

  } catch (error) {
    console.error('[subscribe] Unexpected error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
