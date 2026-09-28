'use client';

/**
 * Browser-based test publisher.
 *
 * Grabs the Mac webcam via getUserMedia, opens an RTCPeerConnection,
 * pushes the video track to Cloudflare Realtime, and prints the
 * publisherSessionId that the /viewer page needs in its ?session=
 * query param.
 *
 * Two tabs on the same laptop, one /publisher and one /viewer, is
 * a video and controller-input dashboard test. The Python broadcaster
 * provides the corresponding robot-side camera source.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { InputPacket } from 'eloport/lib/types';

type Status =
  | 'idle'
  | 'getting-media'
  | 'negotiating'
  | 'live'
  | 'error';

const TRACK_NAME = 'robot-camera';

export default function PublisherPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<InputPacket | null>(null);
  const [inputRate, setInputRate] = useState(0);
  const rateCountRef = useRef({ count: 0, lastTick: Date.now() });

  // Demo recorder state
  const [recording, setRecording] = useState(false);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [recordFrameCount, setRecordFrameCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedInputRef = useRef<InputPacket[]>([]);
  const recordingActiveRef = useRef(false);
  const recordStartTsRef = useRef(0);

  // Subscribe to the live XR input bridge once we're publishing.
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/input/stream?session=${sessionId}`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.hello) return;
        const packet = data as InputPacket;
        setLastInput(packet);
        rateCountRef.current.count += 1;
        if (recordingActiveRef.current) {
          recordedInputRef.current.push(packet);
          setRecordFrameCount(recordedInputRef.current.length);
        }
      } catch {}
    };
    es.onerror = () => console.warn('[publisher] SSE error');

    const tick = setInterval(() => {
      const now = Date.now();
      const elapsed = now - rateCountRef.current.lastTick;
      const rate = (rateCountRef.current.count * 1000) / elapsed;
      setInputRate(Math.round(rate));
      rateCountRef.current = { count: 0, lastTick: now };
    }, 1000);

    return () => {
      es.close();
      clearInterval(tick);
    };
  }, [sessionId]);

  // Clean up the peer connection + media stream on unmount
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      pcRef.current = null;
      const stream = mediaStreamRef.current;
      stream?.getTracks().forEach((t) => t.stop());
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) {
      setError('No media stream — start publishing first');
      return;
    }

    recordedChunksRef.current = [];
    recordedInputRef.current = [];
    setRecordedBytes(0);
    setRecordFrameCount(0);
    setLastSaved(null);
    recordStartTsRef.current = Date.now();

    // Pick the best available codec supported by the browser
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ??
      'video/webm';

    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    recorderRef.current = rec;

    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) {
        recordedChunksRef.current.push(ev.data);
        setRecordedBytes((b) => b + ev.data.size);
      }
    };

    rec.onstop = async () => {
      const videoBlob = new Blob(recordedChunksRef.current, { type: mimeType });
      const name = `session-${recordStartTsRef.current}`;
      const inputMeta = {
        startedAt: recordStartTsRef.current,
        endedAt: Date.now(),
        sessionId,
        frames: recordedInputRef.current,
      };

      const form = new FormData();
      form.append('name', name);
      form.append('video', videoBlob, 'video.webm');
      form.append('input', JSON.stringify(inputMeta, null, 2));

      try {
        const res = await fetch('/api/recording/save-session', {
          method: 'POST',
          body: form,
        });
        const data = await res.json();
        if (data.ok) {
          setLastSaved(data.path);
          console.log('[publisher] Session saved:', data);
        } else {
          console.error('[publisher] save failed:', data);
          setError(`Recording save failed: ${JSON.stringify(data)}`);
        }
      } catch (e) {
        console.error('[publisher] upload failed:', e);
        setError(`Upload failed: ${String(e)}`);
      }
    };

    rec.start(1000);
    recordingActiveRef.current = true;
    setRecording(true);
  }, [sessionId]);

  const stopRecording = useCallback(() => {
    recordingActiveRef.current = false;
    setRecording(false);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus('getting-media');

    try {
      // Keep the test resolution modest — we're on a laptop webcam and the
      // PRD targets 360p first, 720p later. Adjust later for real testing.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      mediaStreamRef.current = stream;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        bundlePolicy: 'max-bundle',
      });
      pcRef.current = pc;

      // Add the camera track as a sendonly transceiver. We need the transceiver
      // reference later so we can read its `mid` — Cloudflare Realtime uses
      // `mid` to correlate each entry in the `tracks` array with a section
      // of the SDP offer.
      const [videoTrack] = stream.getVideoTracks();
      const transceiver = pc.addTransceiver(videoTrack, {
        direction: 'sendonly',
        streams: [stream],
      });

      setStatus('negotiating');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (max 3s) so the SDP we send to
      // Cloudflare already contains all candidates — otherwise the server
      // doesn't know how to reach us.
      await waitForIceGatheringComplete(pc, 3000);

      if (!transceiver.mid) {
        throw new Error('Transceiver has no mid after setLocalDescription');
      }

      // Step 1: Create session with SDP offer → get answer
      const res = await fetch('/api/publisher/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerSdp: pc.localDescription!.sdp,
          offerType: pc.localDescription!.type,
          tracks: [{ trackName: TRACK_NAME, mid: transceiver.mid }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Publish failed: ${res.status} ${errText}`);
      }

      const data = (await res.json()) as {
        type: RTCSdpType;
        sdp: string;
        publisherSessionId: string;
      };

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: data.type, sdp: data.sdp }),
      );

      // Step 2: Wait for PC to connect, then register track names
      await waitForConnected(pc, 10000);

      const trackRes = await fetch('/api/publisher/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publisherSessionId: data.publisherSessionId,
          tracks: [{ trackName: TRACK_NAME, mid: transceiver.mid }],
        }),
      });

      if (!trackRes.ok) {
        console.warn('[publisher] Track registration failed:', await trackRes.text());
      }

      setSessionId(data.publisherSessionId);
      setStatus('live');
    } catch (e) {
      console.error('[publisher]', e);
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  // Fetch the server's LAN URL once so QR codes point to a host the Zapbox
  // can actually reach (not localhost).
  const [lanBase, setLanBase] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/host')
      .then((r) => r.json())
      .then((d) => setLanBase(d.lanUrl ?? null))
      .catch(() => {
        if (typeof window !== 'undefined') setLanBase(window.location.origin);
      });
  }, []);

  const viewerUrl =
    sessionId && lanBase
      ? `${lanBase}/viewer?session=${sessionId}&track=${TRACK_NAME}`
      : null;

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!viewerUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(viewerUrl, {
      width: 256,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch((e) => console.error('[publisher] QR generation failed:', e));
  }, [viewerUrl]);

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-950 p-8 text-zinc-100">
      <h1 className="text-3xl font-bold tracking-tight">Publisher (test rig)</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Pushes your webcam into Cloudflare Realtime. Use the printed viewer URL
        on the Zapbox/Quest (or another tab).
      </p>

      <div className="mt-8 w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="aspect-video w-full rounded-lg bg-black"
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={status !== 'idle' && status !== 'error'}
            className="rounded-md bg-emerald-600 px-4 py-2 font-mono text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {status === 'live' ? 'Live' : 'Start publishing'}
          </button>
          <span className="font-mono text-xs text-zinc-400">status: {status}</span>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-red-900 bg-red-950 p-3 font-mono text-xs text-red-300">
            {error}
          </p>
        )}

        {viewerUrl && (
          <div className="mt-4 flex flex-col gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs md:flex-row md:items-center">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Viewer URL QR code"
                width={168}
                height={168}
                className="shrink-0 rounded-md bg-white p-2"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-zinc-500">
                # Scan with the Zapbox, or open this URL:
              </p>
              <a
                href={viewerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all text-emerald-400 underline"
              >
                {viewerUrl}
              </a>
              <p className="mt-2 text-zinc-500">
                session: <span className="text-zinc-300">{sessionId}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(viewerUrl);
                }}
                className="mt-2 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Copy URL
              </button>
            </div>
          </div>
        )}
      </div>

      {sessionId && (
        <>
          <div className="mt-6 w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  Demo recorder
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Captures the webcam video and all XR input packets into a
                  paired session under <code className="text-zinc-400">recordings/</code>.
                </p>
              </div>
              {recording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded-md bg-red-600 px-4 py-2 font-mono text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
                  Stop &amp; save
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  className="rounded-md bg-red-600/80 px-4 py-2 font-mono text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  Start recording
                </button>
              )}
            </div>

            {(recording || recordFrameCount > 0) && (
              <div className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs">
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-zinc-500">video</p>
                  <p className="mt-1 text-zinc-200">
                    {(recordedBytes / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-zinc-500">input frames</p>
                  <p className="mt-1 text-zinc-200">{recordFrameCount}</p>
                </div>
              </div>
            )}

            {lastSaved && (
              <p className="mt-3 rounded-md border border-emerald-900 bg-emerald-950/40 p-2 font-mono text-xs text-emerald-300">
                saved → {lastSaved}
              </p>
            )}
          </div>

          <InputMonitor input={lastInput} rate={inputRate} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live XR input monitor — shows operator headset + controllers + buttons
// streaming in from the viewer via /api/input/stream (SSE)
// ---------------------------------------------------------------------------

function InputMonitor({
  input,
  rate,
}: {
  input: InputPacket | null;
  rate: number;
}) {
  const ts = input ? new Date(input.ts).toLocaleTimeString() : '—';
  const leftCtrl = input?.controllers.find((c) => c.hand === 'left');
  const rightCtrl = input?.controllers.find((c) => c.hand === 'right');

  return (
    <div className="mt-6 w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">
          Live XR input
          <span
            className={`ml-3 inline-block h-2 w-2 rounded-full ${
              rate > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'
            }`}
          />
        </h2>
        <span className="font-mono text-xs text-zinc-400">
          {rate} pkt/s · {ts}
        </span>
      </div>

      <p className="mt-1 text-xs text-zinc-500">
        Headset pose, controller poses &amp; buttons streamed back from the
        viewer. This is what a robot receiver would act on.
      </p>

      {!input ? (
        <p className="mt-6 font-mono text-xs text-zinc-500">
          waiting for operator input… (enter VR on the viewer)
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <PoseCard
            title="Headset"
            color="text-cyan-400"
            position={input.headset.position}
            orientation={input.headset.orientation}
          />
          <ControllerCard
            title="Left controller"
            color="text-fuchsia-400"
            hand="left"
            ctrl={leftCtrl}
          />
          <ControllerCard
            title="Right controller"
            color="text-amber-400"
            hand="right"
            ctrl={rightCtrl}
          />

          <div className="col-span-full flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3">
            <span className="font-mono text-xs text-zinc-500">arm latch</span>
            <span
              className={`font-mono text-sm font-bold ${
                input.armLatched ? 'text-emerald-400' : 'text-zinc-500'
              }`}
            >
              {input.armLatched ? 'LATCHED' : 'UNLATCHED'}
            </span>
          </div>

          <BindingCheck leftCtrl={leftCtrl} rightCtrl={rightCtrl} />
        </div>
      )}
    </div>
  );
}

/** Walks the operator through pressing each button and confirms the mapping. */
function BindingCheck({
  leftCtrl,
  rightCtrl,
}: {
  leftCtrl?: {
    axes: number[];
    buttons: { pressed: boolean; value: number }[];
  };
  rightCtrl?: {
    axes: number[];
    buttons: { pressed: boolean; value: number }[];
  };
}) {
  type Binding = {
    label: string;
    purpose: string;
    hand: 'left' | 'right';
    kind: 'button' | 'axis';
    index: number;
    axisDim?: 0 | 1; // for sticks, 0=x 1=y
  };

  const bindings: Binding[] = [
    { label: 'Right A', purpose: 'Toggle arm latch', hand: 'right', kind: 'button', index: 4 },
    { label: 'Right B', purpose: 'Toggle HUD', hand: 'right', kind: 'button', index: 5 },
    { label: 'Left trigger', purpose: 'Gripper close (analog)', hand: 'left', kind: 'button', index: 0 },
    { label: 'Left grip', purpose: 'Gripper close (alt)', hand: 'left', kind: 'button', index: 1 },
    { label: 'Left Y', purpose: 'Toggle REC (HUD only)', hand: 'left', kind: 'button', index: 5 },
    { label: 'Left stick X', purpose: 'Strafe', hand: 'left', kind: 'axis', index: 2 },
    { label: 'Left stick Y', purpose: 'Fwd/back', hand: 'left', kind: 'axis', index: 3 },
    { label: 'Right stick X', purpose: 'Yaw', hand: 'right', kind: 'axis', index: 2 },
  ];

  const stateFor = (b: Binding) => {
    const c = b.hand === 'left' ? leftCtrl : rightCtrl;
    if (!c) return { active: false, value: 0 };
    if (b.kind === 'button') {
      const btn = c.buttons[b.index];
      return { active: btn?.pressed ?? false, value: btn?.value ?? 0 };
    }
    const v = c.axes[b.index] ?? 0;
    return { active: Math.abs(v) > 0.15, value: v };
  };

  return (
    <div className="col-span-full rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm font-bold text-zinc-200">
          Binding check
        </h3>
        <span className="font-mono text-[10px] text-zinc-500">
          press each one — it should light up green
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {bindings.map((b) => {
          const { active, value } = stateFor(b);
          return (
            <div
              key={b.label}
              className={`flex items-center justify-between rounded border px-3 py-2 font-mono text-[11px] transition-colors ${
                active
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-100'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              <span>
                <span className="font-bold">{b.label}</span>
                <span className="ml-2 text-zinc-500">→ {b.purpose}</span>
              </span>
              <span className="font-mono text-[10px]">
                {b.kind === 'button'
                  ? active
                    ? '●'
                    : value > 0.05
                      ? value.toFixed(2)
                      : '○'
                  : value.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PoseCard({
  title,
  color,
  position,
  orientation,
}: {
  title: string;
  color: string;
  position: [number, number, number];
  orientation: [number, number, number, number];
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
      <p className={`font-bold ${color}`}>{title}</p>
      <div className="mt-2 space-y-1 text-zinc-300">
        <KV label="pos" v={position.map((n) => n.toFixed(2)).join(', ')} />
        <KV label="quat" v={orientation.map((n) => n.toFixed(2)).join(', ')} />
      </div>
    </div>
  );
}

// Standard WebXR gamepad mapping (per W3C spec).
// buttons[0] = trigger, buttons[1] = grip/squeeze, buttons[2] = reserved,
// buttons[3] = thumbstick click, buttons[4] = primary face (A / X),
// buttons[5] = secondary face (B / Y).
const BUTTON_LABELS_RIGHT = ['trig', 'grip', '—', 'stk', 'A', 'B'];
const BUTTON_LABELS_LEFT = ['trig', 'grip', '—', 'stk', 'X', 'Y'];

function ControllerCard({
  title,
  color,
  ctrl,
  hand,
}: {
  title: string;
  color: string;
  hand: 'left' | 'right';
  ctrl?: {
    position: [number, number, number];
    orientation: [number, number, number, number];
    axes: number[];
    buttons: { pressed: boolean; value: number }[];
  };
}) {
  if (!ctrl) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
        <p className={`font-bold ${color}`}>{title}</p>
        <p className="mt-2 text-zinc-600">not tracked</p>
      </div>
    );
  }

  const labels = hand === 'left' ? BUTTON_LABELS_LEFT : BUTTON_LABELS_RIGHT;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
      <p className={`font-bold ${color}`}>{title}</p>
      <div className="mt-2 space-y-1 text-zinc-300">
        <KV label="pos" v={ctrl.position.map((n) => n.toFixed(2)).join(', ')} />
        <KV
          label="quat"
          v={ctrl.orientation.map((n) => n.toFixed(2)).join(', ')}
        />
        <KV
          label="axes"
          v={ctrl.axes.map((n) => n.toFixed(2)).join(', ') || '—'}
        />
      </div>

      <div className="mt-3">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
          buttons
        </p>
        <div className="grid grid-cols-6 gap-1">
          {Array.from({ length: 6 }).map((_, i) => {
            const btn = ctrl.buttons[i];
            const pressed = btn?.pressed ?? false;
            const value = btn?.value ?? 0;
            const label = labels[i] ?? `b${i}`;
            return (
              <div
                key={i}
                className={`flex flex-col items-center rounded border px-1 py-1 transition-colors ${
                  pressed
                    ? 'border-emerald-400 bg-emerald-500/30 text-emerald-200'
                    : value > 0.05
                      ? 'border-amber-700 bg-amber-900/20 text-amber-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-500'
                }`}
              >
                <span className="text-[9px]">{i}</span>
                <span className="text-[10px] font-bold">{label}</span>
                {btn && value > 0 && value < 1 && (
                  <span className="text-[9px] opacity-70">
                    {value.toFixed(1)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {ctrl.axes.length >= 2 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            stick (axes 2,3)
          </p>
          <AxisPad
            x={ctrl.axes[2] ?? 0}
            y={ctrl.axes[3] ?? 0}
            color={color}
          />
        </div>
      )}
    </div>
  );
}

function AxisPad({ x, y, color }: { x: number; y: number; color: string }) {
  const size = 72;
  const half = size / 2;
  const dotX = half + x * (half - 6);
  const dotY = half + y * (half - 6);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full border border-zinc-700 bg-zinc-900" />
      <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-800" />
      <div className="absolute left-0 top-1/2 h-px w-full bg-zinc-800" />
      <div
        className={`absolute h-3 w-3 rounded-full ${color.replace('text-', 'bg-')}`}
        style={{
          left: dotX - 6,
          top: dotY - 6,
          transition: 'left 0.05s, top 0.05s',
        }}
      />
      <span className="absolute -bottom-4 right-0 font-mono text-[9px] text-zinc-500">
        {x.toFixed(2)}, {y.toFixed(2)}
      </span>
    </div>
  );
}

function KV({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small WebRTC helpers
// ---------------------------------------------------------------------------

function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function waitForConnected(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (pc.connectionState === 'connected') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onChange = () => {
      if (pc.connectionState === 'connected') {
        cleanup();
        resolve();
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        cleanup();
        reject(new Error(`Peer connection ${pc.connectionState}`));
      }
    };
    const cleanup = () => {
      pc.removeEventListener('connectionstatechange', onChange);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for peer connection'));
    }, timeoutMs);
    pc.addEventListener('connectionstatechange', onChange);
  });
}
