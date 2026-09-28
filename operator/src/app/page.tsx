import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-20 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-8">
        <p className="font-mono text-sm text-emerald-400">SO-101 / ZAPBOX / WEBXR</p>
        <h1 className="text-4xl font-semibold tracking-tight">See through the camera. Move the arm.</h1>
        <p className="max-w-2xl text-lg text-zinc-400">The camera streams through Cloudflare Realtime. Your controllers connect directly to the SO-101 bridge over a secure WebSocket.</p>
        <ol className="list-decimal space-y-5 pl-6 text-zinc-300">
          <li>Start the camera broadcaster and the robot bridge using the repository setup instructions.</li>
          <li>Open the full viewer link printed by the broadcaster on your Zapbox or WebXR headset. Enter XR to connect the arm bridge.</li>
          <li>Press right A to latch or unlatch the arm. Move the right controller; left trigger closes the gripper and left grip opens it.</li>
        </ol>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-3 font-semibold">Viewer link format</p>
          <code className="break-all text-sm text-emerald-400">/viewer?session=SESSION_ID&amp;track=robot-camera&amp;stereo=sbs&amp;bridge=wss://BRIDGE_HOST:8765</code>
          <p className="mt-3 text-sm text-zinc-400">The bridge is optional for video viewing. Exit XR to close the bridge. Re-enter XR to reconnect, then press A to latch again. Hardware telemetry is not available.</p>
        </div>
        <p className="text-sm text-zinc-400">For a browser webcam test, use <Link href="/publisher" className="text-emerald-400 underline">the camera publisher</Link>. Its viewer link streams video; add your bridge URL to enable arm control.</p>
      </div>
    </main>
  );
}
