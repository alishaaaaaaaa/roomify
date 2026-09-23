// The landing page - replaces the framework's default "Welcome" scaffold
// page. Its only job is to explain what the app does in one sentence
// and get the user into the actual flow (starting at room setup).

import { Link } from "react-router";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Roomify - design your room with real furniture" },
    {
      name: "description",
      content:
        "Lay out your room, furnish it with real products, and see it in 3D before you buy.",
    },
  ];
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-stone-950">
      <header className="mx-auto w-full max-w-6xl px-6 py-6">
        <span className="text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Roomify
        </span>
      </header>

      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl dark:text-stone-100">
          Design your room with furniture you can actually buy
        </h1>
        <p className="mt-4 max-w-xl text-lg text-stone-600 dark:text-stone-400">
          Set your room's real dimensions, furnish it by dragging in real
          products, walk through it in 3D, and check out when you're happy
          with it.
        </p>
        <Link
          to="/room-setup"
          className="mt-8 rounded-full bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          Start designing →
        </Link>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-6 text-center text-xs text-stone-400">
        Built with the Shopify Storefront API.
      </footer>
    </div>
  );
}
