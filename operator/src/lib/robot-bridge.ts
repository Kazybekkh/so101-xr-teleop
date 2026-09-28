import type { InputPacket } from './types';

export type BridgeState = 'unconfigured' | 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
type SocketFactory = (url: string) => WebSocket;

/** A direct, bounded transport. Never queues robot commands while disconnected. */
export function createRobotBridge(
  url: string | null,
  pageProtocol: string,
  onState: (state: BridgeState, message: string) => void,
  onDisarm: () => void,
  makeSocket: SocketFactory = (address) => new WebSocket(address),
) {
  let socket: WebSocket | null = null;
  let lastPacket: InputPacket | null = null;
  let address: string | null = null;
  let error: string | null = null;

  if (url) {
    try {
      const parsed = new URL(url);
      if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error('Use a ws:// or wss:// bridge URL.');
      if (parsed.username || parsed.password) throw new Error('Do not put credentials in the bridge URL.');
      if (pageProtocol === 'https:' && parsed.protocol !== 'wss:') {
        throw new Error('This HTTPS viewer requires a wss:// bridge.');
      }
      address = parsed.toString();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Invalid bridge URL.';
    }
  }

  function stop(message = 'Bridge closed; arm disabled.') {
    const previous = socket;
    socket = null;
    if (previous) {
      if (previous.readyState === 1 && previous.bufferedAmount === 0 && lastPacket) {
        try { previous.send(JSON.stringify({ ...lastPacket, ts: Date.now(), armLatched: false, controllers: [] })); } catch { /* Socket already closed. */ }
      }
      previous.onopen = null;
      previous.onclose = null;
      previous.onerror = null;
      previous.close();
    }
    lastPacket = null;
    onDisarm();
    onState(error ? 'error' : address ? 'closed' : 'unconfigured', error ?? message);
  }

  function start() {
    if (!address) {
      onState(error ? 'error' : 'unconfigured', error ?? 'Video only. Add ?bridge=wss://HOST:8765 to control the arm.');
      return;
    }
    if (socket) return;
    onDisarm();
    onState('connecting', 'Connecting to arm bridge…');
    try {
      const current = makeSocket(address);
      socket = current;
      current.onopen = () => {
        if (socket !== current) return;
        onDisarm();
        onState('connected', 'Bridge connected. Press right A to enable arm control.');
      };
      current.onclose = () => {
        if (socket !== current) return;
        socket = null;
        lastPacket = null;
        onDisarm();
        onState('closed', 'Bridge disconnected; arm disabled. Exit and re-enter XR to reconnect.');
      };
      current.onerror = () => {
        if (socket !== current) return;
        stop('Bridge connection failed. Check its URL and trusted TLS certificate.');
      };
    } catch (e) {
      stop(e instanceof Error ? e.message : 'Bridge connection failed.');
    }
  }

  function send(packet: InputPacket): boolean {
    if (!socket || socket.readyState !== 1) return false;
    const age = Date.now() - packet.ts;
    if (!Number.isFinite(packet.ts) || age > 250 || age < -1000) {
      stop('Stale input rejected; arm disabled. Exit and re-enter XR to reconnect.');
      return false;
    }
    // A prior command is still queued: disconnect instead of adding stale motion.
    if (socket.bufferedAmount > 0) {
      stop('Bridge network congested; arm disabled. Exit and re-enter XR to reconnect.');
      return false;
    }
    try {
      socket.send(JSON.stringify(packet));
      lastPacket = packet;
      return true;
    } catch {
      stop('Bridge send failed; arm disabled.');
      return false;
    }
  }

  onState(error ? 'error' : address ? 'idle' : 'unconfigured', error ?? (address ? 'Bridge ready. Enter XR to connect.' : 'Video only. Add ?bridge=wss://HOST:8765 to control the arm.'));
  return { start, stop, send, isConnected: () => socket?.readyState === 1 };
}
