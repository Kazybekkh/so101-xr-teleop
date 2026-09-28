import assert from 'node:assert/strict';
import test from 'node:test';
import { createRobotBridge } from '../src/lib/robot-bridge.ts';

function setup(url = 'wss://localhost:8765', protocol = 'https:') {
  const states = [];
  let disarmed = 0;
  const sockets = [];
  const bridge = createRobotBridge(url, protocol,
    (state, message) => states.push({ state, message }),
    () => { disarmed++; },
    () => {
      const socket = {
        readyState: 0, bufferedAmount: 0, sent: [],
        send(data) { this.sent.push(JSON.parse(data)); },
        close() { this.readyState = 3; },
      };
      sockets.push(socket);
      return socket;
    });
  return { bridge, states, sockets, get disarmed() { return disarmed; } };
}
function packet(ts = Date.now()) {
  return { ts, armLatched: true, controllers: [], headset: { position: [0,0,0], orientation: [0,0,0,1] } };
}
function connect(state) {
  state.bridge.start();
  const socket = state.sockets.at(-1);
  socket.readyState = 1;
  socket.onopen();
  return socket;
}

test('HTTPS refuses insecure or invalid bridge addresses before opening a socket', () => {
  for (const url of ['ws://192.168.0.2:8765', 'https://example.com', 'bad', 'wss://user:secret@example.com']) {
    const state = setup(url);
    state.bridge.start();
    assert.equal(state.sockets.length, 0);
    assert.equal(state.states.at(-1).state, 'error');
  }
});

test('never queues input while disconnected; only fresh input is sent after connect', () => {
  const state = setup();
  assert.equal(state.bridge.send(packet()), false);
  const socket = connect(state);
  assert.deepEqual(socket.sent, []);
  assert.equal(state.bridge.send(packet()), true);
  assert.equal(socket.sent.length, 1);
  assert.equal(state.bridge.isConnected(), true);
});

test('closing XR disarms and sends a disabled packet without controller buttons', () => {
  const state = setup();
  const socket = connect(state);
  state.bridge.send(packet());
  state.bridge.stop();
  assert.equal(socket.sent.at(-1).armLatched, false);
  assert.deepEqual(socket.sent.at(-1).controllers, []);
  assert.equal(socket.readyState, 3);
  assert.equal(state.bridge.isConnected(), false);
  assert.equal(state.bridge.send(packet()), false);
  assert.ok(state.disarmed >= 3);
});

test('stale input or network backlog closes transport and never appends motion', () => {
  for (const stale of [false, true]) {
    const state = setup();
    const socket = connect(state);
    if (!stale) socket.bufferedAmount = 512;
    assert.equal(state.bridge.send(packet(stale ? Date.now() - 1000 : Date.now())), false);
    assert.deepEqual(socket.sent, []);
    assert.equal(socket.readyState, 3);
    assert.equal(state.bridge.isConnected(), false);
  }
});

test('disconnect disarms and reconnect requires an explicit start without replay', () => {
  const state = setup();
  const socket = connect(state);
  state.bridge.send(packet());
  socket.readyState = 3;
  socket.onclose();
  assert.equal(state.states.at(-1).state, 'closed');
  assert.equal(state.sockets.length, 1);
  const next = connect(state);
  assert.deepEqual(next.sent, []);
});
