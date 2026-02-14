"use client";

import Link from "next/link";
import { Ship } from "lucide-react";

export const Logo = () => {
  return (
    <Link href="/" className="flex items-center gap-1">
      <Ship className="size-6 text-brand" />
      <span
        className="font-primary text-2xl font-extrabold italic -tracking-[0.025em] bg-clip-text text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--text-beam-from), var(--text-beam-via), var(--text-beam-to))",
        }}
      >
        Ruya
      </span>
      <span className="text-lg font-light text-gray-400 dark:text-gray-500">
        Hacks
      </span>
    </Link>
  );
};
