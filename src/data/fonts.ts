import type { FontChoice } from "../types";

export const FONT_OPTIONS: FontChoice[] = [
  {
    id: "oswald",
    name: "Oswald",
    family: '"Oswald", "Arial Narrow", sans-serif',
    category: "blocky",
  },
  {
    id: "playfair",
    name: "Playfair Display",
    family: '"Playfair Display", Georgia, serif',
    category: "serif",
  },
  {
    id: "pacifico",
    name: "Pacifico",
    family: '"Pacifico", "Brush Script MT", cursive',
    category: "cursive",
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    family: '"JetBrains Mono", "Courier New", monospace',
    category: "mono",
  },
  {
    id: "bebas-neue",
    name: "Bebas Neue",
    family: '"Bebas Neue", Impact, sans-serif',
    category: "display",
  },
];

export const DEFAULT_FONT_ID = "playfair";
