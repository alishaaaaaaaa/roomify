// The room setup screen: pick room dimensions and colors before
// furnishing it. Every input here is directly wired to the Zustand
// store, so as soon as the user changes a value, it's saved to shared
// state immediately - no separate "save" step needed for this part.

import { useNavigate } from "react-router";
import { StepNav } from "~/components/StepNav";
import { useRoomStore } from "~/store/roomStore";

export default function RoomSetup() {
  const navigate = useNavigate();

  const dimensions = useRoomStore((state) => state.dimensions);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const setDimensions = useRoomStore((state) => state.setDimensions);
  const setWallColor = useRoomStore((state) => state.setWallColor);
  const setFloorColor = useRoomStore((state) => state.setFloorColor);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <StepNav />

      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Set up your room
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Enter your room's real dimensions in centimeters, then pick wall
          and floor colors.
        </p>

        <div className="mt-8 space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="grid grid-cols-3 gap-4">
            <NumberField
              label="Width (cm)"
              value={dimensions.widthCm}
              onChange={(value) =>
                setDimensions({ ...dimensions, widthCm: value })
              }
            />
            <NumberField
              label="Length (cm)"
              value={dimensions.lengthCm}
              onChange={(value) =>
                setDimensions({ ...dimensions, lengthCm: value })
              }
            />
            <NumberField
              label="Height (cm)"
              value={dimensions.heightCm}
              onChange={(value) =>
                setDimensions({ ...dimensions, heightCm: value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ColorField
              label="Wall color"
              value={wallColor}
              onChange={setWallColor}
            />
            <ColorField
              label="Floor color"
              value={floorColor}
              onChange={setFloorColor}
            />
          </div>
        </div>

        <button
          onClick={() => navigate("/design")}
          className="mt-6 w-full rounded-full bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          Continue to floor plan →
        </button>
      </main>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
        {label}
      </span>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-800">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
        />
        <span className="text-sm text-stone-500 dark:text-stone-400">
          {value}
        </span>
      </div>
    </label>
  );
}