/** Reserved telemetry shape. Hardware telemetry is not currently connected. */
export interface TelemetryData {
  battery: number;
  jointTemps: number[];
  latency: number;
  status: 'unavailable' | 'idle' | 'teleop' | 'docked' | 'error';
}

/** Per-controller snapshot sent back to the robot. */
export interface ControllerInput {
  hand: 'left' | 'right' | 'none';
  position: [number, number, number];
  orientation: [number, number, number, number]; // quaternion xyzw
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

/** Full input packet sent to the robot at ~30 Hz. */
export interface InputPacket {
  ts: number;
  headset: {
    orientation: [number, number, number, number]; // quaternion xyzw
    position: [number, number, number];
  };
  controllers: ControllerInput[];
  armLatched: boolean;
}

export const DEFAULT_TELEMETRY: TelemetryData = {
  battery: -1,
  jointTemps: [],
  latency: -1,
  status: 'unavailable',
};
