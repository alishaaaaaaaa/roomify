// The very first screen the user sees: pick room dimensions and colors
// before furnishing it. Every input here is directly wired to the
// Zustand store, so as soon as the user changes a value, it's saved to
// shared state immediately - no separate "save" step needed for this part.

import { useNavigate } from "react-router";
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
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 480 }}>
      <h1>Set up your room</h1>
      <p style={{ color: "#666" }}>
        Enter your room's real dimensions in centimeters, then pick wall and
        floor colors.
      </p>

      <label style={{ display: "block", marginBottom: 12 }}>
        Width (cm)
        <input
          type="number"
          value={dimensions.widthCm}
          onChange={(e) =>
            setDimensions({ ...dimensions, widthCm: Number(e.target.value) })
          }
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        Length (cm)
        <input
          type="number"
          value={dimensions.lengthCm}
          onChange={(e) =>
            setDimensions({ ...dimensions, lengthCm: Number(e.target.value) })
          }
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        Ceiling height (cm)
        <input
          type="number"
          value={dimensions.heightCm}
          onChange={(e) =>
            setDimensions({ ...dimensions, heightCm: Number(e.target.value) })
          }
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        Wall color
        <input
          type="color"
          value={wallColor}
          onChange={(e) => setWallColor(e.target.value)}
          style={{ display: "block", marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 20 }}>
        Floor color
        <input
          type="color"
          value={floorColor}
          onChange={(e) => setFloorColor(e.target.value)}
          style={{ display: "block", marginTop: 4 }}
        />
      </label>

      <button
        onClick={() => navigate("/design")}
        style={{
          padding: "10px 20px",
          background: "#111",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Continue to layout →
      </button>
    </div>
  );
}