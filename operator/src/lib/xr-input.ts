import type { ControllerInput } from './types';

export interface XRInputSnapshot {
  headset: {
    orientation: [number, number, number, number];
    position: [number, number, number];
  };
  controllers: ControllerInput[];
}

/**
 * Read headset + controller state from a single XRFrame.
 * Returns null when no viewer pose is available (e.g. tracking lost).
 */
export function readXRInput(
  frame: XRFrame,
  refSpace: XRReferenceSpace,
  session: XRSession,
): XRInputSnapshot | null {
  const viewerPose = frame.getViewerPose(refSpace);
  if (!viewerPose) return null;

  const { orientation: hq, position: hp } = viewerPose.transform;

  const controllers: ControllerInput[] = [];

  for (const source of session.inputSources) {
    // Prefer gripSpace (hand/controller pose) but fall back to targetRaySpace
    // — some platforms (Zapbox, some AR devices) only expose the ray.
    const space = source.gripSpace ?? source.targetRaySpace;
    if (!space) continue;

    const pose = frame.getPose(space, refSpace);
    if (!pose) continue;

    const { position: p, orientation: q } = pose.transform;
    const hand =
      source.handedness === 'left'
        ? 'left'
        : source.handedness === 'right'
          ? 'right'
          : 'none';

    const gamepad = source.gamepad;
    const axes = gamepad ? Array.from(gamepad.axes) : [];
    const buttons = gamepad
      ? Array.from(gamepad.buttons).map((b) => ({
          pressed: b.pressed,
          value: b.value,
        }))
      : [];

    controllers.push({
      hand,
      position: [p.x, p.y, p.z],
      orientation: [q.x, q.y, q.z, q.w],
      axes,
      buttons,
    });
  }

  return {
    headset: {
      orientation: [hq.x, hq.y, hq.z, hq.w],
      position: [hp.x, hp.y, hp.z],
    },
    controllers,
  };
}
