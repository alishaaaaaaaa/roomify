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
//  - a textured floor (tile / hardwood / concrete), soft shadows, a light
//    studio environment, baseboards and walls that fade when they block
//    the camera
//  - one wall PER EDGE of the polygon, each individually positioned and
//    rotated to sit exactly along that edge - this is what makes
//    arbitrary bends and angles in a room actually show up in 3D
//
// Three.js scenes need actual browser graphics (WebGL) to render, which
// doesn't exist on the server. So we wait until the component has
// "mounted" in the browser before rendering the <Canvas> at all - on
// the server, and for a brief instant in the browser before JavaScript
// finishes loading, we just show a simple loading message instead.

import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  OrbitControls,
  RoundedBox,
  useGLTF,
} from "@react-three/drei";
import {
  Box3,
  CanvasTexture,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Vector3,
} from "three";
import { StepNav } from "~/components/StepNav";
import { useRoomStore, type PlacedItem } from "~/store/roomStore";
import {
  getEffectiveFootprint,
  getPolygonBounds,
  getWallSegments,
} from "~/lib/geometry";
import {
  FLOOR_PERIOD_CM,
  getFloorOption,
  paintFloorCanvas,
  type FloorId,
} from "~/lib/flooring";

const WALL_THICKNESS_M = 0.1;
const BASEBOARD_HEIGHT_M = 0.09;

export default function Walkthrough() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const shape = useRoomStore((state) => state.shape);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const floorType = useRoomStore((state) => state.floorType);
  const placedItems = useRoomStore((state) => state.placedItems);

  // Same idea as the 2D floor plan: work in coordinates relative to the
  // room's bounding-box corner, in meters (three.js convention).
  const bounds = getPolygonBounds(shape.points);
  const roomWidthM = (bounds.maxX - bounds.minX) / 100;
  const roomDepthM = (bounds.maxZ - bounds.minZ) / 100;
  const heightM = shape.heightCm / 100;

  // Memoized so these only rebuild when the room's shape changes.
  const localPointsM = useMemo(
    () =>
      shape.points.map((p) => ({
        x: (p.x - bounds.minX) / 100,
        z: (p.z - bounds.minZ) / 100,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape.points]
  );

  const floorShape = useMemo(() => {
    const s = new Shape();
    // A Shape lives in its own 2D (x, y) plane; z is negated so that
    // after the mesh is laid flat (-90deg around X) it isn't mirrored.
    s.moveTo(localPointsM[0].x, -localPointsM[0].z);
    for (const p of localPointsM.slice(1)) s.lineTo(p.x, -p.z);
    s.closePath();
    return s;
  }, [localPointsM]);

  const walls = useMemo(
    () => getWallSegments(localPointsM, WALL_THICKNESS_M),
    [localPointsM]
  );

  const maxDim = Math.max(roomWidthM, roomDepthM);

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
            // Re-created if the room's size changes so the camera starts
            // in a sensible spot for the new room.
            key={`${roomWidthM.toFixed(2)}x${roomDepthM.toFixed(2)}`}
            shadows
            dpr={[1, 2]}
            camera={{
              position: [
                roomWidthM / 2 + maxDim * 0.9,
                heightM + maxDim * 0.8,
                roomDepthM / 2 + maxDim * 1.1,
              ],
              fov: 45,
            }}
          >
            <color attach="background" args={["#d9d4cc"]} />

            {/* Soft studio-style reflections, built from a few light
                panels (no image download needed) */}
            <Environment resolution={256} environmentIntensity={0.55}>
              <Lightformer
                form="rect"
                intensity={2}
                position={[0, 5, 0]}
                rotation-x={Math.PI / 2}
                scale={[10, 10, 1]}
              />
              <Lightformer
                form="rect"
                intensity={1.2}
                position={[-6, 2, 2]}
                rotation-y={Math.PI / 2}
                scale={[8, 4, 1]}
              />
              <Lightformer
                form="rect"
                intensity={0.8}
                position={[6, 2, -2]}
                rotation-y={-Math.PI / 2}
                scale={[8, 4, 1]}
              />
            </Environment>

            <hemisphereLight args={["#ffffff", "#b8aa98", 0.5]} />
            <directionalLight
              castShadow
              position={[
                roomWidthM / 2 + maxDim * 0.6,
                heightM * 2.2,
                roomDepthM / 2 + maxDim * 0.4,
              ]}
              target-position={[roomWidthM / 2, 0, roomDepthM / 2]}
              intensity={1.6}
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0004}
              shadow-normalBias={0.02}
              shadow-camera-left={-maxDim}
              shadow-camera-right={maxDim}
              shadow-camera-top={maxDim}
              shadow-camera-bottom={-maxDim}
              shadow-camera-near={0.5}
              shadow-camera-far={maxDim * 6 + heightM * 4}
            />

            <Floor
              shape={floorShape}
              floorType={floorType}
              floorColor={floorColor}
            />

            {walls.map((w, i) => (
              <Wall key={i} wall={w} heightM={heightM} color={wallColor} />
            ))}

            {/* Baseboards: a thin trim strip along the foot of each wall,
                just inside the room */}
            {walls.map((w, i) => (
              <mesh
                key={`bb-${i}`}
                position={[
                  w.edgeMidX - w.outwardX * 0.01,
                  BASEBOARD_HEIGHT_M / 2,
                  w.edgeMidZ - w.outwardZ * 0.01,
                ]}
                rotation={[0, w.angleY, 0]}
                receiveShadow
              >
                <boxGeometry args={[w.edgeLength, BASEBOARD_HEIGHT_M, 0.02]} />
                <meshStandardMaterial color="#fbfaf7" roughness={0.5} />
              </mesh>
            ))}

            {/* Furniture, from the same data the 2D planner uses. Real
                .glb models where a product has one, nice placeholder
                boxes otherwise. Suspense because loading a model file is
                asynchronous. */}
            <Suspense fallback={null}>
              {placedItems.map((item) => (
                <PlacedFurnitureMesh key={item.id} item={item} />
              ))}
            </Suspense>

            <OrbitControls
              target={[roomWidthM / 2, heightM * 0.3, roomDepthM / 2]}
              maxPolarAngle={Math.PI / 2 - 0.05}
              minDistance={maxDim * 0.4}
              maxDistance={maxDim * 3}
              enableDamping
            />
          </Canvas>
        ) : (
          <div className="p-6 text-sm text-stone-300">Loading 3D view…</div>
        )}
      </div>
    </div>
  );
}

// The floor: a polygon filled with the chosen material. For tile/hardwood/
// concrete the painted picture (see lib/flooring.ts) is repeated across
// the floor at real-world scale; "custom" is just a flat color.
function Floor({
  shape,
  floorType,
  floorColor,
}: {
  shape: Shape;
  floorType: FloorId;
  floorColor: string;
}) {
  const gl = useThree((state) => state.gl);

  const texture = useMemo(() => {
    if (floorType === "custom") return null;
    const canvas = paintFloorCanvas(floorType, 1024);
    if (!canvas) return null;
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    // ShapeGeometry UVs are in meters, and one picture covers
    // FLOOR_PERIOD_CM, so this keeps tiles/planks at true size.
    const repeat = 100 / FLOOR_PERIOD_CM;
    t.repeat.set(repeat, repeat);
    return t;
  }, [floorType, gl]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const option = floorType === "custom" ? null : getFloorOption(floorType);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        key={texture ? texture.uuid : "flat"}
        map={texture ?? undefined}
        color={texture ? "#ffffff" : floorColor}
        roughness={option?.roughness ?? 0.8}
        side={DoubleSide}
      />
    </mesh>
  );
}

// One wall slab. Walls between the camera and the room's inside fade to
// nearly see-through so you can always look in, while the walls behind
// stay solid - which makes the room read as a room.
function Wall({
  wall,
  heightM,
  color,
}: {
  wall: ReturnType<typeof getWallSegments>[number];
  heightM: number;
  color: string;
}) {
  const meshRef = useRef<Mesh>(null);
  const opacity = useRef(1);

  useFrame(({ camera }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const towardCamera =
      (camera.position.x - wall.edgeMidX) * wall.outwardX +
      (camera.position.z - wall.edgeMidZ) * wall.outwardZ;
    const target = towardCamera > 0 ? 0.08 : 1;
    opacity.current = MathUtils.damp(opacity.current, target, 8, delta);
    const material = mesh.material as MeshStandardMaterial;
    material.opacity = opacity.current;
    material.depthWrite = opacity.current > 0.5;
    mesh.castShadow = opacity.current > 0.5;
  });

  return (
    <mesh
      ref={meshRef}
      position={[wall.centerX, heightM / 2, wall.centerZ]}
      rotation={[0, wall.angleY, 0]}
      receiveShadow
    >
      <boxGeometry args={[wall.length, heightM, WALL_THICKNESS_M]} />
      {/* Always "transparent" so fading never needs a shader rebuild */}
      <meshStandardMaterial color={color} roughness={0.95} transparent />
    </mesh>
  );
}

// A stable, pleasant wood-ish tone per product, so different placeholder
// boxes are told apart in the room.
function placeholderColor(productId: string) {
  let h = 0;
  for (let i = 0; i < productId.length; i++) {
    h = (h * 31 + productId.charCodeAt(i)) >>> 0;
  }
  const hue = 22 + (h % 18);
  const light = 38 + ((h >> 5) % 14);
  return `hsl(${hue}, 38%, ${light}%)`;
}

// If a 3D model file fails to load (bad link, deleted file, network
// hiccup), show the plain placeholder box for that one item instead of
// letting the error take down the whole 3D view.
class ModelBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("A 3D model failed to load; showing a box instead.", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
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
  // three.js turns the opposite way round to the 2D plan's CSS
  // rotation (clockwise on screen), so the angle is negated here so
  // that an item faces the same way in 3D as it did in the plan.
  const rotationYRadians = -(item.rotationY * Math.PI) / 180;

  const itemWidthM = item.widthCm / 100;
  const itemHeightM = item.heightCm / 100;
  const itemDepthM = item.depthCm / 100;

  const box = (
    <RoundedBox
      args={[itemWidthM, itemHeightM, itemDepthM]}
      radius={Math.min(0.03, itemWidthM / 4, itemHeightM / 4, itemDepthM / 4)}
      smoothness={4}
      position={[x, itemHeightM / 2, z]}
      rotation={[0, rotationYRadians, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={placeholderColor(item.productId)}
        roughness={0.6}
      />
    </RoundedBox>
  );

  if (!item.modelUrl) return box;

  return (
    <ModelBoundary fallback={box}>
      <RealModel
        item={item}
        x={x}
        z={z}
        rotationYRadians={rotationYRadians}
      />
    </ModelBoundary>
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
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

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
