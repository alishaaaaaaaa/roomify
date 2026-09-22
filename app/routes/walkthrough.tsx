// The 3D walkthrough. Everything here reads the exact same room state
// (dimensions, colors, placed items) that the 2D floor planner writes to
// - nothing is duplicated. We're just rendering the same data a
// different way: as an explorable 3D scene instead of a flat top-down
// diagram.
//
// Three.js scenes need actual browser graphics (WebGL) to render, which
// doesn't exist on the server. So we wait until the component has
// "mounted" in the browser before rendering the <Canvas> at all - on
// the server, and for a brief instant in the browser before JavaScript
// finishes loading, we just show a simple loading message instead.

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DoubleSide } from "three";
import { useRoomStore } from "~/store/roomStore";

export default function Walkthrough() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dimensions = useRoomStore((state) => state.dimensions);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const placedItems = useRoomStore((state) => state.placedItems);

  // Three.js scenes conventionally use meters, but we've been tracking
  // everything in centimeters (a more natural unit for someone measuring
  // their real room). Dividing by 100 converts once, here, right at the
  // boundary between "our data" and "the 3D engine."
  const widthM = dimensions.widthCm / 100;
  const lengthM = dimensions.lengthCm / 100;
  const heightM = dimensions.heightCm / 100;

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <div style={{ padding: 16 }}>
        <Link to="/design">← Back to floor plan</Link>
      </div>

      <div style={{ width: "100%", height: "70vh", background: "#333" }}>
        {mounted ? (
          <Canvas
            camera={{
              position: [widthM * 1.4, heightM * 1.8, lengthM * 1.6],
              fov: 50,
            }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 8, 5]} intensity={0.8} />

            {/* Floor - a flat plane rotated to lie horizontal, matching
                the room's real footprint size */}
            <mesh
              position={[widthM / 2, 0, lengthM / 2]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[widthM, lengthM]} />
              <meshStandardMaterial color={floorColor} side={DoubleSide} />
            </mesh>

            {/* Back wall */}
            <mesh position={[widthM / 2, heightM / 2, 0]}>
              <planeGeometry args={[widthM, heightM]} />
              <meshStandardMaterial color={wallColor} side={DoubleSide} />
            </mesh>

            {/* Left wall */}
            <mesh
              position={[0, heightM / 2, lengthM / 2]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <planeGeometry args={[lengthM, heightM]} />
              <meshStandardMaterial color={wallColor} side={DoubleSide} />
            </mesh>

            {/* Right wall - the wall facing the camera (front) is left
                open on purpose, like a dollhouse, so you can actually
                see and orbit around inside the room */}
            <mesh
              position={[widthM, heightM / 2, lengthM / 2]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <planeGeometry args={[lengthM, heightM]} />
              <meshStandardMaterial color={wallColor} side={DoubleSide} />
            </mesh>

            {/* Furniture: one box per placed item, sized and positioned
                from the exact same data the 2D floor planner uses -
                same widthCm/depthCm/position, just converted to meters
                and given a real height so it stands up off the floor */}
            {placedItems.map((item) => {
              const itemWidthM = item.widthCm / 100;
              const itemHeightM = item.heightCm / 100;
              const itemDepthM = item.depthCm / 100;
              // item.position.x/z is the item's top-left corner in cm
              // (matches the 2D view); a box's position is its CENTER,
              // so we add half the width/depth before converting to meters
              const x = (item.position.x + item.widthCm / 2) / 100;
              const y = itemHeightM / 2;
              const z = (item.position.z + item.depthCm / 2) / 100;

              return (
                <mesh key={item.id} position={[x, y, z]}>
                  <boxGeometry args={[itemWidthM, itemHeightM, itemDepthM]} />
                  <meshStandardMaterial color="#8a6d4b" />
                </mesh>
              );
            })}

            {/* Lets you click-drag to orbit, scroll to zoom, right-click
                drag to pan - "target" is the point the camera orbits
                around, set to the room's center */}
            <OrbitControls target={[widthM / 2, heightM / 2, lengthM / 2]} />
          </Canvas>
        ) : (
          <div style={{ color: "#fff", padding: 24 }}>Loading 3D view…</div>
        )}
      </div>
    </div>
  );
}