// A shared header shown across the three-step flow (Room Setup -> Floor
// Plan -> 3D View). Having one component for this means the "current
// step" highlighting logic lives in exactly one place, and every page
// gets a consistent header for free instead of each route inventing its
// own version.

import { Link, useLocation } from "react-router";

const STEPS = [
  { path: "/room-setup", label: "1. Room setup" },
  { path: "/design", label: "2. Floor plan" },
  { path: "/walkthrough", label: "3. 3D view" },
];

export function StepNav() {
  const location = useLocation();

  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <Link
          to="/"
          className="text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100"
        >
          Roomify
        </Link>
        <nav className="flex gap-1">
          {STEPS.map((step) => {
            const isActive = location.pathname === step.path;
            return (
              <Link
                key={step.path}
                to={step.path}
                className={
                  "rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm " +
                  (isActive
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100")
                }
              >
                {step.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
