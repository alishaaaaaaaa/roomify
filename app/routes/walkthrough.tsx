// The 3D walkthrough. Everything here reads the exact same room state
// (shape, colors, placed items) that the 2D floor planner writes to -
// nothing is duplicated. We're just rendering the same data a different
// way: as an explorable 3D scene instead of a flat top-down diagram.
//
// The room can now be any polygon shape, not just a rectangle, so this
// file builds:
//  - the floor as a real polygon mesh (via Three.js's Shape, which
//    correctly fills in even a concave shape like an L, unlike a naive
//    "fan of triangles from the center" approach which breaks on
//    concave shapes)
//  - one wall PER EDGE of the polygon, each individually positioned and
//    rotated to sit exactly along that edge - this is what makes
//    arbitrary bends and angles in a room actually show up in 3D
//
// Three.js scenes need actual browser graphics (WebGL) to render, which
// doesn't exist on the server. So we wait until the component has
// "mounted" in the browser before rendering the <Canvas> at all - on
// the server, and for a brief instant in the browser before JavaScript
// finishes loading, we just show a simple loading message instead.

import { Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, DoubleSide, Shape, Vector3 } from "three";
import { StepNav } from "~/components/StepNav";
import { useRoomStore, type PlacedItem } from "~/store/roomStore";
import { getEffectiveFootprint, getPolygonBounds } from "~/lib/geometry";

export default function Walkthrough() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const shape = useRoomStore((state) => state.shape);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const placedItems = useRoomStore((state) => state.placedItems);

  // Same idea as the 2D floor plan: find the room's bounding box, and
  // work in coordinates relative to its top-left corner (in meters,
  // since Three.js scenes conventionally use meters, not centimeters).
  const bounds = getPolygonBounds(shape.points);
  const roomWidthM = (bounds.maxX - bounds.minX) / 100;
  const roomDepthM = (bounds.maxZ - bounds.minZ) / 100;
  const heightM = shape.heightCm / 100;

  // Points shifted to be relative to the bounding box, then converted
  // to meters - this is the exact same coordinate frame the placed
  // items already use, so everything lines up without extra math.
  const localPointsM = shape.points.map((p) => ({
    x: (p.x - bounds.minX) / 100,
    z: (p.z - bounds.minZ) / 100,
  }));

  // Building the floor shape is memoized since it only needs to be
  // recomputed when the room's actual shape changes, not on every
  // render (e.g. not while furniture is being dragged around).
  const floorShape = useMemo(() => {
    const s = new Shape();
    // A Shape lives in its own local 2D (x, y) plane. We negate z here
    // so that after rotating the mesh flat (-90 degrees around X), the
    // shape lands with the correct, non-mirrored orientation in world
    // space - verified by working through the rotation math by hand
    // rather than eyeballing it, since a flipped floor is an easy
    // mistake that only becomes obvious on a non-symmetric room shape.
    s.moveTo(localPointsM[0].x, -localPointsM[0].z);
    for (const p of localPointsM.slice(1)) {
      s.lineTo(p.x, -p.z);
    }
    s.closePath();
    return s;
  }, [localPointsM]);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <StepNav />

      <div className="mx-auto max-w-6xl px-6 py-4">
        <Link
          to="/design"
          className="text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
        >
          ← Back to floor plan
        </Link>
      </div>

      <div className="mx-auto h-[70vh] max-w-6xl overflow-hidden rounded-2xl bg-stone-800 px-0 shadow-inner sm:mx-6">
        {mounted ? (
          <Canvas
            camera={{
              position: [roomWidthM * 1.4, heightM * 1.8, roomDepthM * 1.6],
              fov: 50,
            }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 8, 5]} intensity={0.8} />

            {/* Floor - a real polygon, correctly filled even for a
                concave shape like an L-shaped room */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <shapeGeometry args={[floorShape]} />
              <meshStandardMaterial color={floorColor} side={DoubleSide} />
            </mesh>

            {/* One wall per edge of the room's polygon. Walls are drawn
                slightly see-through (rather than picking one "front"
                wall to omit, like a plain rectangle can) since an
                arbitrary polygon has no single obvious "front" - this
                way you can always see and orbit around inside the room
                no matter its shape. */}
            {localPointsM.map((a, i) => {
              const b = localPointsM[(i + 1) % localPointsM.length];
              const dx = b.x - a.x;
              const dz = b.z - a.z;
              const length = Math.hypot(dx, dz);
              const midX = (a.x + b.x) / 2;
              const midZ = (a.z + b.z) / 2;
              // Rotates the wall so its width runs along this edge -
              // derived from how Three.js's Y-axis rotation maps a
              // plane's local X onto the world X/Z plane, then checked
              // against simple axis-aligned edges by hand.
              const angleY = Math.atan2(-dz, dx);

              return (
                <mesh
                  key={i}
                  position={[midX, heightM / 2, midZ]}
                  rotation={[0, angleY, 0]}
                >
                  <planeGeometry args={[length, heightM]} />
                  <meshStandardMaterial
                    color={wallColor}
                    side={DoubleSide}
                    transparent
                    opacity={0.85}
                  />
                </mesh>
              );
            })}

            {/* Furniture: one mesh per placed item, positioned from the
                exact same data the 2D floor planner uses - same
                widthCm/depthCm/position, just converted to meters. If
                the product has a real 3D model attached in Shopify, we
                render THAT (see PlacedFurnitureMesh); otherwise we fall
                back to a plain placeholder box so the room still shows
                something roughly the right size and shape. Wrapped in
                Suspense since loading a .glb file is asynchronous - the
                fallback lets already-loaded items keep showing while a
                new one is still fetching. */}
            <Suspense fallback={null}>
              {placedItems.map((item) => (
                <PlacedFurnitureMesh key={item.id} item={item} />
              ))}
            </Suspense>

            {/* Lets you click-drag to orbit, scroll to zoom, right-click
                drag to pan - "target" is the point the camera orbits
                around, set to the room's center */}
            <OrbitControls
              target={[roomWidthM / 2, heightM / 2, roomDepthM / 2]}
            />
          </Canvas>
        ) : (
          <div className="p-6 text-sm text-stone-300">Loading 3D view…</div>
        )}
      </div>
    </div>
  );
}

// Works out this item's position and rotation (shared by both the real
// model and the placeholder box below), then renders whichever one
// applies. item.position.x/z is stored as the top-left corner of the
// item's EFFECTIVE (rotated) bounding-box footprint, not its raw
// dimensions - items can be rotated to any angle now, so that footprint
// needs the same trigonometry the 2D floor plan uses (see
// getEffectiveFootprint), not just a width/depth swap at 90/270 degrees.
function PlacedFurnitureMesh({ item }: { item: PlacedItem }) {
  const footprint = getEffectiveFootprint(
    item.widthCm,
    item.depthCm,
    item.rotationY
  );
  const x = item.position.x / 100 + footprint.width / 100 / 2;
  const z = item.position.z / 100 + footprint.depth / 100 / 2;
  const rotationYRadians = (item.rotationY * Math.PI) / 180;

  if (item.modelUrl) {
    return (
      <RealModel
        item={item}
        x={x}
        z={z}
        rotationYRadians={rotationYRadians}
      />
    );
  }

  const itemWidthM = item.widthCm / 100;
  const itemHeightM = item.heightCm / 100;
  const itemDepthM = item.depthCm / 100;

  return (
    <mesh
      position={[x, itemHeightM / 2, z]}
      rotation={[0, rotationYRadians, 0]}
    >
      <boxGeometry args={[itemWidthM, itemHeightM, itemDepthM]} />
      <meshStandardMaterial color="#8a6d4b" />
    </mesh>
  );
}

// Loads the product's ACTUAL 3D model (a .glb uploaded to that product
// in Shopify) and drops it into the room. Two things a raw model file
// can't be trusted to match on its own:
//  - its real-world SIZE, since it was modeled/exported independently
//    of our widthCm/heightCm/depthCm data - so we measure its bounding
//    box after loading and scale it to fit those dimensions exactly.
//  - its PIVOT POINT, since an arbitrary .glb might be centered on its
//    origin, sitting on the floor, or anything else - so we also
//    re-center it horizontally and drop it so its bottom sits on the
//    floor (y = 0), matching where the placeholder box and the 2D plan
//    both assume the item sits.
function RealModel({
  item,
  x,
  z,
  rotationYRadians,
}: {
  item: PlacedItem;
  x: number;
  z: number;
  rotationYRadians: number;
}) {
  // useGLTF suspends (throws a promise) while the model is loading -
  // that's what the <Suspense> wrapper around all the furniture is for.
  // If the .glb fails to load (bad URL, network error), this throws for
  // real, which without an error boundary would crash the whole scene -
  // acceptable for now since a broken model URL is worth noticing and
  // fixing in Shopify, but worth revisiting if that turns out to happen
  // often in practice.
  const { scene } = useGLTF(item.modelUrl!);

  // Cloned so that placing the same product twice doesn't have both
  // copies fighting over one shared Object3D instance.
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  const { scale, centerOffset, bottomY } = useMemo(() => {
    const box = new Box3().setFromObject(clonedScene);
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);

    return {
      // Guard against a degenerate (zero-size) axis so a broken/empty
      // model doesn't scale to Infinity.
      scale: new Vector3(
        item.widthCm / 100 / (size.x || 1),
        item.heightCm / 100 / (size.y || 1),
        item.depthCm / 100 / (size.z || 1)
      ),
      centerOffset: center,
      bottomY: box.min.y,
    };
  }, [clonedScene, item.widthCm, item.heightCm, item.depthCm]);

  return (
    <group position={[x, 0, z]} rotation={[0, rotationYRadians, 0]}>
      <primitive
        object={clonedScene}
        scale={[scale.x, scale.y, scale.z]}
        position={[
          -centerOffset.x * scale.x,
          -bottomY * scale.y,
          -centerOffset.z * scale.z,
        ]}
      />
    </group>
  );
}
