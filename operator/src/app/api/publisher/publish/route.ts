import { type NextRequest } from 'next/server';

/**
 * POST /api/publisher/publish
 *
 * Server-side signaling for the local test publisher.
 * Creates a new Cloudflare Realtime session, pushes local tracks,
 * and returns the SDP answer plus the sessionId so the viewer can
 * subscribe to `publisherSessionId + trackName`.
 *
 * This exists so we can test the viewer end-to-end from two browser
 * tabs on the same Mac without needing the robot-side broadcaster.
 * Delete/disable later once Utsav's real publisher is running.
 *
 * Request body:
 *   {
 *     offerSdp:  string,   // from browser's RTCPeerConnection
 *     offerType: string,   // "offer"
 *     tracks: Array<{
 *       trackName: string, // caller-chosen, e.g. "robot-camera"
 *       mid:       string, // RTCRtpTransceiver.mid for this track
 *     }>,
 *   }
 *
 * Response:
 *   {
 *     type: "answer",
 *     sdp:  string,
 *     publisherSessionId: string,
 *     trackNames: string[],
 *   }
 */

const CF_APP_ID = process.env.CLOUDFLARE_REALTIME_APP_ID;
const CF_TOKEN = process.env.CLOUDFLARE_REALTIME_TOKEN;
const CF_BASE = 'https://rtc.live.cloudflare.com/v1/apps';

function cfHeaders() {
  return {
    Authorization: `Bearer ${CF_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

type PublishBody = {
  offerSdp: string;
  offerType: string;
  tracks: Array<{ trackName: string; mid: string }>;
};

export async function POST(request: NextRequest) {
  if (!CF_APP_ID || !CF_TOKEN) {
    return Response.json(
      {
        error:
          'Cloudflare Realtime not configured. Set CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_TOKEN in .env.local',
      },
      { status: 503 },
    );
  }

  let body: PublishBody;
  try {
    body = (await request.json()) as PublishBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { offerSdp, offerType, tracks } = body;
  if (!offerSdp || !tracks?.length) {
    return Response.json(
      { error: 'Missing required fields: offerSdp, tracks[]' },
      { status: 400 },
    );
  }

  try {
    // Create the CF session with the SDP offer.
    // Track registration happens in a second request from the browser
    // after the PeerConnection is connected (POST /api/publisher/tracks).
    const sessionRes = await fetch(`${CF_BASE}/${CF_APP_ID}/sessions/new`, {
      method: 'POST',
      headers: cfHeaders(),
      body: JSON.stringify({
        sessionDescription: { type: offerType, sdp: offerSdp },
      }),
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      console.error('[publish] CF create session error:', err);
      return Response.json(
        { error: `CF session error: ${sessionRes.status}` },
        { status: 502 },
      );
    }

    const sessionData = (await sessionRes.json()) as {
      sessionId: string;
      sessionDescription: { type: string; sdp: string };
    };
    console.log('[publish] Publisher session created:', sessionData.sessionId);

    return Response.json({
      type: sessionData.sessionDescription.type,
      sdp: sessionData.sessionDescription.sdp,
      publisherSessionId: sessionData.sessionId,
    });
  } catch (error) {
    console.error('[publish] Unexpected error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
