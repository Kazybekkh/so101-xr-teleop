'use client';

/**
 * Operator-side WebXR stereo viewer.
 *
 * Features:
 *   - Video stream receiving via Cloudflare Realtime (subscribe/renegotiate)
 *   - WebXR stereo rendering (Three.js + VRButton, mono + SBS modes)
 *   - XR input reading: headset orientation (quaternion), controller poses,
 *     gamepad axes/buttons
 *   - Direct WebSocket sending input to bridge/main.py at ~30 Hz
 *   - Bridge socket status (hardware telemetry is not implemented)
 *   - Latch/unlatch arm control (right-controller A button)
 *   - HUD / telemetry panel (right-controller B button to toggle)
 *
 * URL params:
 *   ?session=SESSION_ID   (required) — publisher's CF session id
 *   &track=robot-camera   (optional) — track name, default "robot-camera"
 *   &stereo=mono|sbs      (optional) — default "mono"
 *   &bridge=wss://HOST:8765 (optional) — direct SO-101 robot bridge
 *
 * Controller mapping (standard XR gamepad):
 *   Right A  (buttons[4]) — toggle arm latch
 *   Right B  (buttons[5]) — toggle HUD
 *   Left trigger / grip  — close / open the gripper
 */

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

import type { InputPacket } from 'eloport/lib/types';
import { createRobotBridge } from 'eloport/lib/robot-bridge';
import { DEFAULT_TELEMETRY } from 'eloport/lib/types';
import { readXRInput } from 'eloport/lib/xr-input';
import {
  createHUD,
  positionHUD,
  createControlLegend,
  createRecIndicator,
  createToast,
} from 'eloport/lib/hud';

const LEFT_EYE_LAYER = 1;
const RIGHT_EYE_LAYER = 2;

const INPUT_SEND_HZ = 30;
const INPUT_SEND_INTERVAL = 1000 / INPUT_SEND_HZ;

type StereoMode = 'mono' | 'sbs';

// Standard XR gamepad button indices
// Right hand: A = 4, B = 5
// Left hand:  X = 4, Y = 5
// NOTE: buttons[0] = trigger, buttons[1] = grip.
// Left trigger + grip are RESERVED for the robot's gripper (per PRD §3.4).
// Do not bind any UI actions to them.
const BTN_A = 4;
const BTN_B = 5;
const BTN_Y = 5; // left hand "Y" shares index 5 with right "B"

function Viewer() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const publisherSessionId = searchParams.get('session');
    const trackName = searchParams.get('track') ?? 'robot-camera';
    const stereo: StereoMode =
      searchParams.get('stereo') === 'sbs' ? 'sbs' : 'mono';

    if (!publisherSessionId) {
      if (statusRef.current) statusRef.current.textContent = 'Missing video session. Open the full viewer link printed by the broadcaster or publisher.';
      return;
    }
    if (!containerRef.current || !videoRef.current) return;

    console.log(
      `[viewer] session=${publisherSessionId} track=${trackName} stereo=${stereo}`,
    );

    const container = containerRef.current;
    const video = videoRef.current;

    // ---------------------------------------------------------------
    // Mutable state refs (no React re-renders needed)
    // ---------------------------------------------------------------
    let armLatched = false;
    let hudVisible = false;
    const prevButtons: Record<string, boolean[]> = {};
    const telemetry = { ...DEFAULT_TELEMETRY };
    let inputRelayPending = false;
    let lastInputSendTime = 0;

    // ---------------------------------------------------------------
    // XR input recording — captures every input packet into a buffer.
    // Enable with ?session=...&record=true; left Y while HUD is open
    // toggles recording. Trigger/grip remain reserved for the gripper.
    // ---------------------------------------------------------------
    const recording = searchParams.get('record') === 'true';
    const recordedFrames: InputPacket[] = [];
    let recordingActive = false;

    function saveRecording() {
      if (recordedFrames.length === 0) return;
      const filename = `xr-recording-${Date.now()}`;
      console.log(`[viewer] Uploading ${recordedFrames.length} frames to server…`);
      fetch('/api/recording/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: recordedFrames, filename }),
      })
        .then((r) => r.json())
        .then((d) => console.log('[viewer] Recording saved:', d))
        .catch((e) => console.error('[viewer] Recording upload failed:', e));
    }

    // ---------------------------------------------------------------
    // Three.js scene
    // ---------------------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.05,
      100,
    );
    camera.layers.enable(LEFT_EYE_LAYER);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    const vrButton = VRButton.createButton(renderer);
    container.appendChild(vrButton);

    // "Waiting for stream" text visible until video arrives
    const waitCanvas = document.createElement('canvas');
    waitCanvas.width = 512;
    waitCanvas.height = 128;
    const wCtx = waitCanvas.getContext('2d')!;
    wCtx.fillStyle = '#000';
    wCtx.fillRect(0, 0, 512, 128);
    wCtx.fillStyle = '#4ade80';
    wCtx.font = 'bold 32px monospace';
    wCtx.textAlign = 'center';
    wCtx.fillText('Waiting for stream...', 256, 72);
    const waitTex = new THREE.CanvasTexture(waitCanvas);
    const waitMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.4),
      new THREE.MeshBasicMaterial({ map: waitTex, transparent: true }),
    );
    waitMesh.position.set(0, 0, -2);
    scene.add(waitMesh);

    // Video texture via canvas intermediary — mobile GPUs (Zapbox/Quest)
    // crash when Three.js uploads a <video> directly via texImage2D.
    // Drawing to a 2D canvas first guarantees valid pixel data for WebGL.
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 640;
    texCanvas.height = 360;
    const texCtx = texCanvas.getContext('2d')!;
    texCtx.fillStyle = '#000';
    texCtx.fillRect(0, 0, texCanvas.width, texCanvas.height);

    const videoTexture = new THREE.CanvasTexture(texCanvas);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    const FULL_WIDTH = 3.2;
    const FULL_HEIGHT = 1.8;
    const DISTANCE = -2;

    const videoGroup = new THREE.Group();
    videoGroup.position.set(0, 0, DISTANCE);
    videoGroup.visible = false;
    scene.add(videoGroup);

    if (stereo === 'mono') {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(FULL_WIDTH, FULL_HEIGHT),
        new THREE.MeshBasicMaterial({ map: videoTexture }),
      );
      videoGroup.add(mesh);
    } else {
      function eyeMesh(offset: number, layer: number) {
        const geometry = new THREE.PlaneGeometry(FULL_WIDTH, FULL_HEIGHT);
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + offset);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: videoTexture }));
        mesh.layers.set(layer);
        return mesh;
      }
      const leftMesh = eyeMesh(0, LEFT_EYE_LAYER);
      const rightMesh = eyeMesh(0.5, RIGHT_EYE_LAYER);

      videoGroup.add(leftMesh);
      videoGroup.add(rightMesh);
    }

    let videoReady = false;

    // ---------------------------------------------------------------
    // HUD + UI overlays
    // ---------------------------------------------------------------
    const hud = createHUD();
    scene.add(hud.mesh);

    const legend = createControlLegend();
    scene.add(legend.mesh);

    const recIndicator = createRecIndicator();
    scene.add(recIndicator.mesh);

    const toast = createToast();
    scene.add(toast.mesh);

    // Arm latch indicator (small sphere near right wrist)
    const latchIndicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x71717a }),
    );
    latchIndicator.visible = false;
    scene.add(latchIndicator);

    function updateLatchIndicator() {
      (latchIndicator.material as THREE.MeshBasicMaterial).color.set(
        armLatched ? 0x4ade80 : 0x71717a,
      );
    }

    function disarm() {
      armLatched = false;
      updateLatchIndicator();
      if (hudVisible) hud.update(telemetry, false);
    }
    const bridge = createRobotBridge(
      searchParams.get('bridge'),
      window.location.protocol,
      (_state, message) => {
        if (statusRef.current) statusRef.current.textContent = message;
        toast.show(message, _state === 'connected' ? '#4ade80' : '#fbbf24');
      },
      disarm,
    );
    function sendDisabled() {
      disarm();
      bridge.send({
        ts: Date.now(), armLatched: false, controllers: [],
        headset: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      });
    }
    let activeSession: XRSession | null = null;
    const onXRVisibility = () => {
      if (activeSession?.visibilityState !== 'visible') {
        bridge.stop('XR tracking hidden; arm disabled. Exit and re-enter XR to reconnect.');
      }
    };
    const onSessionStart = () => {
      activeSession = renderer.xr.getSession();
      activeSession?.addEventListener('visibilitychange', onXRVisibility);
      bridge.start();
    };
    const onSessionEnd = () => {
      activeSession?.removeEventListener('visibilitychange', onXRVisibility);
      activeSession = null;
      bridge.stop();
    };
    const onVisibilityChange = () => { if (document.hidden) bridge.stop('Viewer hidden; arm disabled. Exit and re-enter XR to reconnect.'); };
    const onPageHide = () => bridge.stop();
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    // ---------------------------------------------------------------
    // Controller visualization — simple box meshes that follow the
    // tracked controllers. Three.js's built-in getController(i) gives
    // us a group that XR runtime auto-positions for us.
    // ---------------------------------------------------------------
    const controllerModels: THREE.Group[] = [];
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.12),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0xc084fc : 0xfbbf24,
        }),
      );
      const ray = new THREE.Mesh(
        new THREE.CylinderGeometry(0.002, 0.002, 0.5, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.4,
        }),
      );
      ray.rotateX(-Math.PI / 2);
      ray.position.z = -0.25;
      ctrl.add(body);
      ctrl.add(ray);
      scene.add(ctrl);
      controllerModels.push(ctrl);

      ctrl.addEventListener('connected', (e: { data?: XRInputSource }) => {
        console.log('[viewer] controller connected:', i, e.data?.handedness, e.data?.profiles);
      });
      ctrl.addEventListener('disconnected', () => {
        console.log('[viewer] controller disconnected:', i);
      });
    }

    // ---------------------------------------------------------------
    // Per-eye layer mask wiring for SBS stereo in XR
    // ---------------------------------------------------------------
    const configureEyeLayers = () => {
      const xrCam = renderer.xr.getCamera() as THREE.ArrayCamera;
      const eyes: THREE.PerspectiveCamera[] = xrCam.cameras ?? [];
      if (eyes.length >= 2) {
        eyes[0].layers.enable(LEFT_EYE_LAYER);
        eyes[1].layers.enable(RIGHT_EYE_LAYER);
        console.log('[viewer] Per-eye layer masks configured');
      }
    };
    renderer.xr.addEventListener('sessionstart', configureEyeLayers);

    const onResize = () => {
      if (!container || renderer.xr.isPresenting) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // ---------------------------------------------------------------
    // Button edge detection — returns true only on the press frame
    // ---------------------------------------------------------------
    function wasJustPressed(hand: string, idx: number, pressed: boolean): boolean {
      const prev = prevButtons[hand];
      const wasPrev = prev?.[idx] ?? false;
      return pressed && !wasPrev;
    }

    function storeButtons(hand: string, buttons: { pressed: boolean }[]) {
      prevButtons[hand] = buttons.map((b) => b.pressed);
    }

    // ---------------------------------------------------------------
    // Render / XR input loop
    // ---------------------------------------------------------------
    let lastDiagLog = 0;
    renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
      if (frame && renderer.xr.isPresenting) {
        const session = renderer.xr.getSession()!;
        const refSpace = renderer.xr.getReferenceSpace()!;
        const xrCam = renderer.xr.getCamera();

        // Periodic diagnostic so we can see tracking state in logs
        if (time - lastDiagLog > 3000) {
          lastDiagLog = time;
          const srcs = Array.from(session.inputSources);
          console.log(
            '[viewer] input sources:',
            srcs.length,
            srcs.map((s) => ({
              handedness: s.handedness,
              grip: !!s.gripSpace,
              ray: !!s.targetRaySpace,
              profiles: s.profiles,
            })),
          );
        }

        const input = readXRInput(frame, refSpace, session);

        if (input) {
          // --- Button edge detection for toggles ---
          for (const ctrl of input.controllers) {
            const hand = ctrl.hand;

            // Right A → toggle arm latch
            if (hand === 'right' && ctrl.buttons[BTN_A]) {
              if (wasJustPressed(hand, BTN_A, ctrl.buttons[BTN_A].pressed)) {
                armLatched = bridge.isConnected() ? !armLatched : false;
                updateLatchIndicator();
                hud.update(telemetry, armLatched, recording ? { active: recordingActive, frames: recordedFrames.length } : undefined);
                toast.show(
                  armLatched ? 'ARM LATCHED' : bridge.isConnected() ? 'ARM UNLATCHED' : 'ARM BRIDGE NOT CONNECTED',
                  armLatched ? '#4ade80' : '#fbbf24',
                );
              }
            }

            // Right B → toggle HUD
            if (hand === 'right' && ctrl.buttons[BTN_B]) {
              if (wasJustPressed(hand, BTN_B, ctrl.buttons[BTN_B].pressed)) {
                hudVisible = !hudVisible;
                hud.mesh.visible = hudVisible;
                if (hudVisible) hud.update(telemetry, armLatched, recording ? { active: recordingActive, frames: recordedFrames.length } : undefined);
              }
            }

            // Store button history after all edge-triggered actions below.
          }

          // Position latch indicator near right controller
          const rightCtrl = input.controllers.find(
            (c: { hand: string }) => c.hand === 'right',
          );
          if (rightCtrl) {
            latchIndicator.visible = true;
            latchIndicator.position.set(
              rightCtrl.position[0],
              rightCtrl.position[1] + 0.04,
              rightCtrl.position[2],
            );
          }

          // Position control legend above left controller, or fall back
          // to bottom-left of the view if no left controller is tracked.
          const leftCtrl = input.controllers.find(
            (c: { hand: string }) => c.hand === 'left',
          );
          legend.mesh.visible = true;
          if (leftCtrl) {
            legend.mesh.position.set(
              leftCtrl.position[0],
              leftCtrl.position[1] + 0.08,
              leftCtrl.position[2],
            );
            legend.mesh.quaternion.copy(xrCam.quaternion);
          } else {
            // Head-locked fallback — lower-left of the field of view
            const legendDir = new THREE.Vector3(-0.2, -0.15, -0.5);
            legendDir.applyQuaternion(xrCam.quaternion);
            legend.mesh.position.copy(xrCam.position).add(legendDir);
            legend.mesh.quaternion.copy(xrCam.quaternion);
          }

          // Position HUD in front of headset
          if (hudVisible) {
            positionHUD(hud.mesh, xrCam);
          }

          // Position recording indicator top-right of view
          if (recording && recordingActive) {
            recIndicator.mesh.visible = true;
            const recDir = new THREE.Vector3(0.2, 0.18, -0.5);
            recDir.applyQuaternion(xrCam.quaternion);
            recIndicator.mesh.position.copy(xrCam.position).add(recDir);
            recIndicator.mesh.quaternion.copy(xrCam.quaternion);
            recIndicator.update(recordedFrames.length, time);
          } else {
            recIndicator.mesh.visible = false;
          }

          // Toast tick
          toast.tick(time, xrCam);

          // --- Recording: left Y, only when HUD is open ---
          // (Left trigger/grip are reserved for the robot gripper.)
          if (recording && hudVisible) {
            if (leftCtrl && leftCtrl.buttons[BTN_Y]) {
              if (wasJustPressed('left', BTN_Y, leftCtrl.buttons[BTN_Y].pressed)) {
                if (!recordingActive) {
                  recordingActive = true;
                  recordedFrames.length = 0;
                  toast.show('REC STARTED', '#ef4444');
                } else {
                  recordingActive = false;
                  toast.show(`REC SAVED (${recordedFrames.length}f)`, '#4ade80');
                  saveRecording();
                }
              }
            }
          }

          for (const ctrl of input.controllers) storeButtons(ctrl.hand, ctrl.buttons);
          if (!rightCtrl && armLatched) sendDisabled();

          // --- Send input at throttled rate ---
          if (time - lastInputSendTime >= INPUT_SEND_INTERVAL) {
            lastInputSendTime = time;

            const packet: InputPacket = {
              ts: Date.now(),
              headset: input.headset,
              controllers: input.controllers,
              armLatched,
            };

            if (recording && recordingActive) {
              recordedFrames.push(packet);
            }

            bridge.send(packet);

            // Also POST to the demo input bridge so another browser tab
            // (e.g. the /publisher dashboard) can visualize the live data.
            if (!inputRelayPending) {
              inputRelayPending = true;
              fetch(`/api/input/push?session=${encodeURIComponent(publisherSessionId)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(packet),
              signal: AbortSignal.timeout(1000),
            }).catch(() => {}).finally(() => { inputRelayPending = false; });
            }
          }
        } else if (armLatched) {
          sendDisabled();
        }
      }

      // Draw video to canvas every frame (safe for mobile GPUs)
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        if (!videoReady) {
          videoReady = true;
          texCanvas.width = video.videoWidth;
          texCanvas.height = video.videoHeight;
          videoGroup.visible = true;
          waitMesh.visible = false;
          console.log('[viewer] Video texture activated via canvas', video.videoWidth, 'x', video.videoHeight);
        }
        texCtx.drawImage(video, 0, 0, texCanvas.width, texCanvas.height);
        videoTexture.needsUpdate = true;
      }

      renderer.render(scene, camera);
    });

    // ---------------------------------------------------------------
    // WebRTC connection manager — handles initial connect, monitors
    // health, and reconnects automatically on failure or stall.
    // ---------------------------------------------------------------
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let attachedTrackId: string | null = null;
    let playChain = Promise.resolve();
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let healthTimer: ReturnType<typeof setInterval> | null = null;
    let lastFrameTime = 0;
    let lastFrameCurrentTime = 0;

    const attachTrack = (track: MediaStreamTrack) => {
      if (track.id === attachedTrackId) return;
      attachedTrackId = track.id;

      playChain = playChain.then(async () => {
        const stream = new MediaStream([track]);
        video.srcObject = stream;
        try {
          await video.play();
          console.log('[viewer] video.play() succeeded');
        } catch (e) {
          console.warn('[viewer] video.play() blocked:', e);
          await new Promise((r) => setTimeout(r, 200));
          try {
            await video.play();
            console.log('[viewer] video.play() retry succeeded');
          } catch (e2) {
            console.warn('[viewer] video.play() retry failed:', e2);
          }
        }
      });
    };

    const teardownPc = () => {
      if (!pc) return;
      try {
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.ontrack = null;
        pc.close();
      } catch {}
      pc = null;
      attachedTrackId = null;
    };

    const scheduleReconnect = (reason: string) => {
      if (cancelled) return;
      if (reconnectTimer) return; // already scheduled
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 10000);
      reconnectAttempt += 1;
      console.warn(
        `[viewer] reconnecting in ${delay}ms (attempt ${reconnectAttempt}, reason: ${reason})`,
      );
      toast.show(`RECONNECTING…`, '#fbbf24');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        teardownPc();
        connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled) return;

      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        bundlePolicy: 'max-bundle',
      });
      const currentPc = pc;

      currentPc.addTransceiver('video', { direction: 'recvonly' });

      // Cloudflare handles video. Robot input travels on the separate bridge socket.

      currentPc.ontrack = (event) => {
        console.log(
          '[viewer] ontrack:',
          event.track.kind,
          event.track.readyState,
          'streams:',
          event.streams.length,
        );
        if (event.track.kind !== 'video') return;
        attachTrack(event.track);
      };

      currentPc.onconnectionstatechange = () => {
        if (currentPc !== pc) return;
        console.log('[viewer] PC state:', currentPc.connectionState);
        if (
          currentPc.connectionState === 'failed' ||
          currentPc.connectionState === 'disconnected'
        ) {
          scheduleReconnect(`pc=${currentPc.connectionState}`);
        } else if (currentPc.connectionState === 'connected') {
          reconnectAttempt = 0;
          lastFrameTime = performance.now();
          lastFrameCurrentTime = video.currentTime;
          toast.show('CONNECTED', '#4ade80');
        }
      };

      currentPc.oniceconnectionstatechange = () => {
        if (currentPc !== pc) return;
        console.log('[viewer] ICE state:', currentPc.iceConnectionState);
        if (currentPc.iceConnectionState === 'failed') {
          scheduleReconnect('ice=failed');
        }
      };

      try {
        const offer = await currentPc.createOffer();
        await currentPc.setLocalDescription(offer);
        await waitForIceGatheringComplete(currentPc, 3000);
        if (cancelled || currentPc !== pc) return;

        // Step 1: Create CF session with SDP offer
        const res = await fetch('/api/viewer/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publisherSessionId,
            trackName,
            offerSdp: currentPc.localDescription!.sdp,
            offerType: currentPc.localDescription!.type,
          }),
        });

        if (!res.ok) {
          console.error('[viewer] subscribe failed:', res.status, await res.text());
          scheduleReconnect('subscribe-failed');
          return;
        }

        const data = (await res.json()) as {
          type: RTCSdpType;
          sdp: string;
          viewerSessionId: string;
        };
        if (cancelled || currentPc !== pc) return;

        await currentPc.setRemoteDescription(
          new RTCSessionDescription({ type: data.type, sdp: data.sdp }),
        );

        // Step 2: Wait connected, then subscribe to the track
        await waitForConnected(currentPc, 10000);
        if (cancelled || currentPc !== pc) return;

        const trackRes = await fetch('/api/viewer/tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            viewerSessionId: data.viewerSessionId,
            publisherSessionId,
            trackName,
          }),
        });

        if (!trackRes.ok) {
          console.error('[viewer] track subscribe failed:', await trackRes.text());
          scheduleReconnect('tracks-failed');
          return;
        }

        const trackData = (await trackRes.json()) as {
          requiresImmediateRenegotiation: boolean;
          sessionDescription: { type: RTCSdpType; sdp: string } | null;
        };

        if (trackData.sessionDescription) {
          const sd = trackData.sessionDescription;
          if (sd.type === 'offer') {
            await currentPc.setRemoteDescription(new RTCSessionDescription(sd));
            const answer = await currentPc.createAnswer();
            await currentPc.setLocalDescription(answer);
            await waitForIceGatheringComplete(currentPc, 3000);
            await renegotiate(currentPc, data.viewerSessionId);
          } else if (sd.type === 'answer') {
            await currentPc.setRemoteDescription(new RTCSessionDescription(sd));
          }
        } else if (trackData.requiresImmediateRenegotiation) {
          const offer2 = await currentPc.createOffer();
          await currentPc.setLocalDescription(offer2);
          await waitForIceGatheringComplete(currentPc, 3000);
          const reRes = await fetch('/api/viewer/renegotiate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              viewerSessionId: data.viewerSessionId,
              offerSdp: currentPc.localDescription!.sdp,
              offerType: currentPc.localDescription!.type,
            }),
          });
          if (!reRes.ok) {
            console.error('[viewer] renegotiate failed:', await reRes.text());
          }
        }

        // Fallback: receiver-scan polling for a few seconds to make sure
        // we actually grabbed the video track from the PC.
        const scanUntil = Date.now() + 10000;
        const scanId = setInterval(() => {
          if (!pc || pc !== currentPc || Date.now() > scanUntil) {
            clearInterval(scanId);
            return;
          }
          if (video.readyState >= video.HAVE_CURRENT_DATA && !video.paused) {
            clearInterval(scanId);
            return;
          }
          for (const r of currentPc.getReceivers()) {
            if (r.track?.kind === 'video' && r.track.readyState === 'live') {
              attachTrack(r.track);
              break;
            }
          }
          if (video.srcObject && video.paused) {
            video.play().catch(() => {});
          }
        }, 500);
      } catch (err) {
        console.error('[viewer] connect error:', err);
        if (!cancelled && currentPc === pc) {
          scheduleReconnect('exception');
        }
      }
    };

    // Health monitor: if the video hasn't progressed in N seconds while we
    // think we're connected, treat it as a stall and reconnect.
    healthTimer = setInterval(() => {
      if (cancelled) return;
      if (!pc || pc.connectionState !== 'connected') return;
      if (!video.srcObject) return;

      const now = performance.now();
      if (video.currentTime !== lastFrameCurrentTime) {
        lastFrameCurrentTime = video.currentTime;
        lastFrameTime = now;
        return;
      }
      // No progress — if it's been >8s, reconnect
      if (now - lastFrameTime > 8000) {
        console.warn('[viewer] video stalled, triggering reconnect');
        lastFrameTime = now;
        scheduleReconnect('video-stalled');
      }
    }, 2000);

    connect();

    // ---------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (healthTimer) clearInterval(healthTimer);
      renderer.setAnimationLoop(null);
      renderer.xr.removeEventListener('sessionstart', configureEyeLayers);
      window.removeEventListener('resize', onResize);
      onSessionEnd();
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      teardownPc();
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      if (vrButton.parentNode === container) {
        container.removeChild(vrButton);
      }
      hud.dispose();
      legend.dispose();
      recIndicator.dispose();
      toast.dispose();
      latchIndicator.geometry.dispose();
      (latchIndicator.material as THREE.Material).dispose();
      waitTex.dispose();
      waitMesh.geometry.dispose();
      (waitMesh.material as THREE.Material).dispose();
      renderer.dispose();
      videoTexture.dispose();
      videoGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    };
  }, [searchParams]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        overflow: 'hidden',
      }}
    >
      <div ref={statusRef} role="status" style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 5, padding: 12, color: '#f4f4f5', background: '#18181bcc', fontFamily: 'sans-serif', pointerEvents: 'none' }}>Preparing viewer…</div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          opacity: 0,
        }}
      />
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense
      fallback={
        <div style={{ position: 'fixed', inset: 0, background: '#000' }} />
      }
    >
      <Viewer />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Renegotiation
// ---------------------------------------------------------------------------

/**
 * Send the browser's current local description (an answer) to CF.
 * Called after the browser has already set CF's offer as remote description
 * and created an answer via pc.createAnswer() + pc.setLocalDescription().
 */
async function renegotiate(
  pc: RTCPeerConnection,
  viewerSessionId: string,
): Promise<void> {
  const res = await fetch('/api/viewer/renegotiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      viewerSessionId,
      offerSdp: pc.localDescription!.sdp,
      offerType: pc.localDescription!.type,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[viewer] renegotiate failed:', res.status, err);
  }
}

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

