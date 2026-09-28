/**
 * In-memory input relay. The viewer POSTs input packets here (keyed by
 * session id) and the publisher / robot dashboard subscribes via SSE.
 *
 * This is a demo-only bridge. A real robot would receive input directly
 * over the WebRTC data channel from its own peer. The broker exists so
 * you can _see_ the teleop input flowing on a second screen.
 */

import type { InputPacket } from './types';

type Subscriber = (packet: InputPacket) => void;

const channels = new Map<string, Set<Subscriber>>();
const lastPacket = new Map<string, InputPacket>();

export function publish(sessionId: string, packet: InputPacket) {
  lastPacket.set(sessionId, packet);
  const subs = channels.get(sessionId);
  if (!subs) return;
  for (const sub of subs) {
    try {
      sub(packet);
    } catch {
      // swallow — subscriber will be cleaned up on close
    }
  }
}

export function subscribe(sessionId: string, cb: Subscriber): () => void {
  let set = channels.get(sessionId);
  if (!set) {
    set = new Set();
    channels.set(sessionId, set);
  }
  set.add(cb);

  // Fire last known packet immediately so UIs hydrate fast.
  const last = lastPacket.get(sessionId);
  if (last) {
    try {
      cb(last);
    } catch {}
  }

  return () => {
    set!.delete(cb);
    if (set!.size === 0) channels.delete(sessionId);
  };
}
