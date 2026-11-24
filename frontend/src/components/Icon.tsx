export type IconName =
  | "arrows"
  | "plus"
  | "arrow"
  | "down"
  | "up"
  | "balance"
  | "home"
  | "plane"
  | "dinner"
  | "basket"
  | "bolt"
  | "chevron"
  | "check"
  | "close";

const paths: Record<IconName, string> = {
  arrows: "M4 7h15m-15 0 4-4M4 7l4 4m12 6H5m15 0-4-4m4 4-4 4",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  down: "M17 7 7 17m0-8v8h8",
  up: "M7 17 17 7m-8 0h8v8",
  balance:
    "M12 3v17M6 20h12M5 6h14M7 6l-4 8h8L7 6m10 0-4 8h8l-4-8M3 14c0 4 8 4 8 0m2 0c0 4 8 4 8 0",
  home: "m3 10 9-7 9 7v10H3V10m6 10v-7h6v7",
  plane: "m21 3-5 12-4-4-4-4 13-4M12 11l-3 9-3-5-5-3 7-5",
  dinner: "M4 3v7m3-7v7m3-7v7m-6 0h6m-3 0v11M20 3c-5 1-5 10 0 10V3m0 10v8",
  basket: "M4 9h16l-2 11H6L4 9m4 0 3-6m5 6-3-6M9 12v5m6-5v5M3 9h18",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7",
  chevron: "m7 10 5 5 5-5",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
