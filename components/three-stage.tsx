'use client';

import { Environment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

/**
 * Procedural studio rig — no CDN fetch, and it bakes once. A metal with no
 * environment has no specular source at all and renders near-black.
 */
export function StudioLights() {
  return (
    <>
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={5} position={[0, 5, 2]} rotation={[-Math.PI / 2, 0, 0]} scale={[10, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2.6} position={[-5, 1, -4]} rotation={[0, -Math.PI / 3, 0]} scale={[8, 4, 1]} color="#9ec2ff" />
        <Lightformer form="rect" intensity={1.8} position={[5, -1, 3]} rotation={[0, Math.PI / 4, 0]} scale={[6, 3, 1]} color="#ffd9b0" />
        <Lightformer form="rect" intensity={1} position={[0, -5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} color="#2a2a3a" />
      </Environment>
      <directionalLight position={[-4, 6, 5]} intensity={1.4} />
    </>
  );
}

/** Frames the subject from a direction, fitted to whichever of the two FOVs is tighter. */
export function CameraRig({ direction, radius, resetKey, controls, target = [0, 0, 0] }: {
  direction: [number, number, number]; radius: number; resetKey: number;
  controls: React.MutableRefObject<any>; target?: [number, number, number];
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(1, size.height);

  useEffect(() => {
    const verticalFov = (camera.fov * Math.PI) / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.08;
    const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    camera.position.set(
      target[0] + (direction[0] / length) * distance,
      target[1] + (direction[1] / length) * distance,
      target[2] + (direction[2] / length) * distance,
    );
    camera.near = Math.max(0.1, distance - radius * 3);
    camera.far = distance + radius * 6;
    camera.updateProjectionMatrix();
    // OrbitControls owns the camera quaternion, so orientation has to go through
    // it — a bare camera.lookAt is overwritten on the controls' next update.
    if (controls.current) {
      controls.current.target.set(target[0], target[1], target[2]);
      controls.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, radius, aspect, resetKey, camera, controls, target[0], target[1], target[2]]);

  return null;
}
