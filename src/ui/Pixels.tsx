/** Tiny 16x16 bitmap icons, drawn from text so they stay pixel-exact. */

const PALETTE: Record<string, string> = {
  "#": "var(--ink)",
  o: "var(--money)",
  w: "#ffffff",
  g: "var(--gold)",
};

export const ICONS = {
  bank: [
    "................",
    ".......##.......",
    ".....##gg##.....",
    "...##gggggg##...",
    ".##############.",
    "................",
    "..##..##..##..##",
    "..##..##..##..##",
    "..##..##..##..##",
    "..##..##..##..##",
    "..##..##..##..##",
    "................",
    "################",
    ".##############.",
    "................",
    "................",
  ],
  write: [
    "................",
    "...........##...",
    "..........#oo#..",
    ".........#oo#...",
    "........#oo#....",
    ".......#oo#.....",
    "......#oo#......",
    ".....#oo#.......",
    "....#oo#........",
    "....###.........",
    "...##...........",
    "................",
    ".##############.",
    ".#wwwwwwwwwwww#.",
    ".##############.",
    "................",
  ],
  deposit: [
    ".......##.......",
    "......#oo#......",
    "......#oo#......",
    "......#oo#......",
    "....###oo###....",
    "....#oooooo#....",
    ".....#oooo#.....",
    "......#oo#......",
    ".......##.......",
    "................",
    ".##############.",
    ".#wwwwwwwwwwww#.",
    ".#w####wwww##w#.",
    ".#wwwwwwwwwwww#.",
    ".##############.",
    "................",
  ],
  register: [
    "................",
    "..###########...",
    "..#oo#wwwwww#...",
    "..#oo#w####w#...",
    "..#oo#wwwwww#...",
    "..#oo#w####w#...",
    "..#oo#wwwwww#...",
    "..#oo#w####w#...",
    "..#oo#wwwwww#...",
    "..#oo#w####w#...",
    "..#oo#wwwwww#...",
    "..#oo########...",
    "..#oo#wwwwwww#..",
    "..############..",
    "................",
    "................",
  ],
} as const;

export type IconName = keyof typeof ICONS;

export function Pixels({ name, size = 32 }: { name: IconName; size?: number }) {
  const rows = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={PALETTE[c]} />
        )
      )}
    </svg>
  );
}
