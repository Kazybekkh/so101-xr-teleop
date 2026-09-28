import * as THREE from 'three';
import type { TelemetryData } from './types';

const W = 512;
const H = 384;
const WORLD_W = 0.6;
const WORLD_H = WORLD_W * (H / W);

export interface HUDHandle {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  update: (telemetry: TelemetryData, armLatched: boolean, rec?: RecState) => void;
  dispose: () => void;
}

export interface RecState {
  active: boolean;
  frames: number;
}

export function createHUD(): HUDHandle {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), material);
  mesh.visible = false;
  mesh.renderOrder = 999;

  const update = (telemetry: TelemetryData, armLatched: boolean, rec?: RecState) => {
    drawHUD(canvas, texture, telemetry, armLatched, rec);
  };

  const dispose = () => {
    texture.dispose();
    material.dispose();
    mesh.geometry.dispose();
  };

  return { mesh, canvas, texture, update, dispose };
}

/** Position the HUD panel 0.5 m in front of the headset, head-locked. */
export function positionHUD(
  mesh: THREE.Object3D,
  camera: THREE.Camera,
) {
  const dir = new THREE.Vector3(0, 0, -0.5);
  dir.applyQuaternion(camera.quaternion);
  mesh.position.copy(camera.position).add(dir);
  mesh.quaternion.copy(camera.quaternion);
}

// ---------------------------------------------------------------------------
// Control legend — a small panel that attaches near the left wrist
// ---------------------------------------------------------------------------

const LEG_W = 400;
const LEG_H = 280;
const LEG_WORLD_W = 0.14;
const LEG_WORLD_H = LEG_WORLD_W * (LEG_H / LEG_W);

export interface LegendHandle {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  dispose: () => void;
}

export function createControlLegend(): LegendHandle {
  const canvas = document.createElement('canvas');
  canvas.width = LEG_W;
  canvas.height = LEG_H;

  drawLegend(canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(LEG_WORLD_W, LEG_WORLD_H),
    material,
  );
  mesh.visible = false;
  mesh.renderOrder = 998;

  const dispose = () => {
    texture.dispose();
    material.dispose();
    mesh.geometry.dispose();
  };

  return { mesh, canvas, texture, dispose };
}

function drawLegend(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(8, 8, 16, 0.88)';
  roundRect(ctx, 0, 0, w, h, 12);
  ctx.fill();

  ctx.strokeStyle = 'rgba(100, 200, 255, 0.25)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, w - 2, h - 2, 12);
  ctx.stroke();

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CONTROLS', w / 2, 32);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(16, 42, w - 32, 1);

  const lines: [string, string][] = [
    ['Right A', 'Arm latch'],
    ['Right B', 'Telemetry HUD'],
    ['Left trigger', 'Close gripper'],
    ['Left grip', 'Open gripper'],
    ['Left Y + HUD', 'Record (if enabled)'],
  ];

  let y = 68;
  ctx.font = '18px monospace';
  for (const [btn, label] of lines) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(btn, 20, y);
    ctx.fillStyle = '#e4e4e7';
    ctx.textAlign = 'right';
    ctx.fillText(label, w - 20, y);

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(16, y + 8, w - 32, 1);
    y += 38;
  }
}

// ---------------------------------------------------------------------------
// Recording indicator — pulsing red dot + frame counter
// ---------------------------------------------------------------------------

const REC_W = 256;
const REC_H = 64;
const REC_WORLD_W = 0.12;
const REC_WORLD_H = REC_WORLD_W * (REC_H / REC_W);

export interface RecIndicatorHandle {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  update: (frames: number, time: number) => void;
  dispose: () => void;
}

export function createRecIndicator(): RecIndicatorHandle {
  const canvas = document.createElement('canvas');
  canvas.width = REC_W;
  canvas.height = REC_H;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(REC_WORLD_W, REC_WORLD_H),
    material,
  );
  mesh.visible = false;
  mesh.renderOrder = 1000;

  const update = (frames: number, time: number) => {
    drawRecIndicator(canvas, texture, frames, time);
  };

  const dispose = () => {
    texture.dispose();
    material.dispose();
    mesh.geometry.dispose();
  };

  return { mesh, canvas, texture, update, dispose };
}

function drawRecIndicator(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  frames: number,
  time: number,
) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(30, 0, 0, 0.85)';
  roundRect(ctx, 0, 0, w, h, 10);
  ctx.fill();

  ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, w - 2, h - 2, 10);
  ctx.stroke();

  // Pulsing red dot
  const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
  ctx.fillStyle = `rgba(239, 68, 68, ${0.5 + pulse * 0.5})`;
  ctx.beginPath();
  ctx.arc(28, h / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('REC', 48, h / 2 + 8);

  ctx.fillStyle = '#fca5a5';
  ctx.font = '18px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${frames}f`, w - 16, h / 2 + 6);

  texture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Toast notification system — brief messages that float + fade
// ---------------------------------------------------------------------------

const TOAST_W = 400;
const TOAST_H = 64;
const TOAST_WORLD_W = 0.2;
const TOAST_WORLD_H = TOAST_WORLD_W * (TOAST_H / TOAST_W);
const TOAST_DURATION = 2000;

export interface ToastHandle {
  mesh: THREE.Mesh;
  show: (message: string, color?: string) => void;
  tick: (time: number, camera: THREE.Camera) => void;
  dispose: () => void;
}

export function createToast(): ToastHandle {
  const canvas = document.createElement('canvas');
  canvas.width = TOAST_W;
  canvas.height = TOAST_H;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TOAST_WORLD_W, TOAST_WORLD_H),
    material,
  );
  mesh.visible = false;
  mesh.renderOrder = 1001;

  let showTime = 0;
  let active = false;

  const show = (message: string, color = '#4ade80') => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, TOAST_W, TOAST_H);

    ctx.fillStyle = 'rgba(10, 10, 18, 0.9)';
    roundRect(ctx, 0, 0, TOAST_W, TOAST_H, 10);
    ctx.fill();

    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, TOAST_W - 2, TOAST_H - 2, 10);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, TOAST_W / 2, TOAST_H / 2);

    texture.needsUpdate = true;
    showTime = performance.now();
    active = true;
    mesh.visible = true;
    material.opacity = 1;
  };

  const tick = (time: number, camera: THREE.Camera) => {
    if (!active) return;

    const elapsed = time - showTime;
    if (elapsed > TOAST_DURATION) {
      active = false;
      mesh.visible = false;
      material.opacity = 0;
      return;
    }

    // Fade out in the last 500ms
    if (elapsed > TOAST_DURATION - 500) {
      material.opacity = (TOAST_DURATION - elapsed) / 500;
    }

    // Position slightly below center of view
    const dir = new THREE.Vector3(0, -0.15, -0.6);
    dir.applyQuaternion(camera.quaternion);
    mesh.position.copy(camera.position).add(dir);
    mesh.quaternion.copy(camera.quaternion);
  };

  const dispose = () => {
    texture.dispose();
    material.dispose();
    mesh.geometry.dispose();
  };

  return { mesh, show, tick, dispose };
}

// ---------------------------------------------------------------------------
// Canvas drawing — main HUD
// ---------------------------------------------------------------------------

function drawHUD(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  data: TelemetryData,
  armLatched: boolean,
  rec?: RecState,
) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(10, 10, 18, 0.90)';
  roundRect(ctx, 0, 0, w, h, 16);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, w - 2, h - 2, 16);
  ctx.stroke();

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SO-101 · TELEMETRY UNAVAILABLE', w / 2, 38);

  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(24, 52, w - 48, 1);

  const LX = 32;
  let y = 82;
  ctx.font = '17px monospace';

  // Battery
  const noData = data.battery < 0;
  const battColor = noData
    ? '#71717a'
    : data.battery > 50
      ? '#4ade80'
      : data.battery > 20
        ? '#fbbf24'
        : '#ef4444';

  row(ctx, w, LX, y, 'Battery', noData ? '—' : `${data.battery}%`, battColor);
  y += 14;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(LX, y, w - 64, 8);
  if (!noData) {
    ctx.fillStyle = battColor;
    ctx.fillRect(LX, y, (w - 64) * (data.battery / 100), 8);
  }

  // Latency
  y += 34;
  const latNoData = data.latency < 0;
  const latColor = latNoData
    ? '#71717a'
    : data.latency < 50
      ? '#4ade80'
      : data.latency < 150
        ? '#fbbf24'
        : '#ef4444';
  row(ctx, w, LX, y, 'Latency', latNoData ? '—' : `${data.latency} ms`, latColor);

  // Status
  y += 34;
  const stColor =
    data.status === 'teleop'
      ? '#4ade80'
      : data.status === 'error'
        ? '#ef4444'
        : '#fbbf24';
  row(ctx, w, LX, y, 'Status', data.status.toUpperCase(), stColor);

  // Arm latch
  y += 34;
  row(
    ctx,
    w,
    LX,
    y,
    'Arm Control',
    armLatched ? 'LATCHED' : 'UNLATCHED',
    armLatched ? '#4ade80' : '#71717a',
  );

  // Recording
  if (rec) {
    y += 34;
    row(
      ctx,
      w,
      LX,
      y,
      'Recording',
      rec.active ? `REC ${rec.frames}f` : 'OFF',
      rec.active ? '#ef4444' : '#71717a',
    );
  }

  // Joint temps
  y += 34;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText('Joint Temps', LX, y);

  if (data.jointTemps.length > 0) {
    y += 22;
    const barW = Math.min(40, (w - 64) / data.jointTemps.length - 4);
    data.jointTemps.forEach((temp, i) => {
      const tc = temp > 70 ? '#ef4444' : temp > 50 ? '#fbbf24' : '#4ade80';
      const x = LX + i * (barW + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, barW, 36);
      const fillH = Math.min(36, (temp / 100) * 36);
      ctx.fillStyle = tc;
      ctx.fillRect(x, y + 36 - fillH, barW, fillH);
      ctx.fillStyle = '#d4d4d8';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${temp}°`, x + barW / 2, y + 50);
    });
  } else {
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'right';
    ctx.fillText('—', w - 32, y);
  }

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  const footer = rec
    ? '[B] close   [A] arm latch   [Y] toggle REC'
    : '[B] close   [A] toggle arm latch';
  ctx.fillText(footer, w / 2, h - 14);

  texture.needsUpdate = true;
}

function row(
  ctx: CanvasRenderingContext2D,
  w: number,
  lx: number,
  y: number,
  label: string,
  value: string,
  color: string,
) {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#a1a1aa';
  ctx.font = '17px monospace';
  ctx.fillText(label, lx, y);
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.fillText(value, w - 32, y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
