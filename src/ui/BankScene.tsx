/**
 * The desktop picture: a pixel-art savings bank on a mint afternoon.
 * Drawn on a 320x180 grid with crisp edges so it scales up like an old bitmap.
 */

const INK = "#34332d";
const STONE = "#f4ecd9";
const STONE_SHADE = "#dccfb1";
const WALL = "#d3c5a4";
const STEP = "#e8dec6";
const GREEN = "#2f6b4f";
const GOLD = "#d8b25a";
const GLASS = "#a9cfcc";

const COLUMNS = [84, 112, 140, 168, 196, 224];
const WINDOWS = [100, 128, 184, 212];

function Cloud({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g fill="#fbfcf5">
      <rect x={x + 4} y={y} width={w - 10} height="4" />
      <rect x={x} y={y + 4} width={w} height="5" />
      <rect x={x + 8} y={y - 3} width={w / 3} height="3" />
    </g>
  );
}

function Lamp({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y="112" width="2" height="38" fill={INK} />
      <rect x={x - 3} y="148" width="8" height="2" fill={INK} />
      <rect x={x - 3} y="104" width="8" height="8" fill={GOLD} stroke={INK} strokeWidth="1" />
      <rect x={x - 2} y="101" width="6" height="3" fill={INK} />
    </g>
  );
}

function Hedge({ x, w }: { x: number; w: number }) {
  return (
    <g>
      <rect x={x + 3} y="138" width={w - 6} height="4" fill="#5f8f6d" />
      <rect x={x} y="141" width={w} height="9" fill="#4f7f5e" />
      <rect x={x} y="146" width={w} height="4" fill="url(#dither-dark)" />
    </g>
  );
}

export function BankScene() {
  return (
    <svg
      className="scene"
      viewBox="0 8 320 172"
      preserveAspectRatio="xMidYMin slice"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <defs>
        <pattern id="dither-light" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#e4f1e6" />
          <rect x="1" y="1" width="1" height="1" fill="#e4f1e6" />
        </pattern>
        <pattern id="dither-shade" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill={STONE_SHADE} />
          <rect x="1" y="1" width="1" height="1" fill={STONE_SHADE} />
        </pattern>
        <pattern id="dither-dark" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#3e6a4d" />
          <rect x="1" y="1" width="1" height="1" fill="#3e6a4d" />
        </pattern>
        <pattern id="paving" width="16" height="6" patternUnits="userSpaceOnUse">
          <rect width="16" height="6" fill="#e6dcc5" />
          <rect width="16" height="1" fill="#d4c8ad" />
          <rect width="1" height="6" fill="#d4c8ad" />
        </pattern>
      </defs>

      {/* Sky, fading to a lighter band at the horizon with a dither. */}
      <rect width="320" height="180" fill="#c9e3d3" />
      <rect y="66" width="320" height="30" fill="url(#dither-light)" />
      <rect y="96" width="320" height="60" fill="#e4f1e6" />

      <Cloud x={26} y={26} w={34} />
      <Cloud x={212} y={18} w={42} />
      <Cloud x={272} y={52} w={26} />
      <Cloud x={118} y={10} w={22} />

      {/* Lawn and pavement. */}
      <rect y="146" width="320" height="34" fill="#a9c7ac" />
      <rect y="150" width="320" height="30" fill="url(#paving)" />

      {/* Flag. */}
      <rect x="159" y="12" width="1" height="24" fill={INK} />
      <rect x="160" y="13" width="14" height="8" fill={GREEN} />
      <rect x="166" y="15" width="2" height="4" fill={GOLD} />

      {/* Pediment, with the bank's name carved in. */}
      <polygon points="64,64 160,34 256,64" fill={STONE} stroke={INK} strokeWidth="1" />
      <polygon points="80,61 160,40 240,61" fill={STONE_SHADE} />
      <text
        x="160"
        y="58"
        textAnchor="middle"
        fontFamily="'Pixelify Sans', monospace"
        fontSize="6.5"
        fontWeight="600"
        letterSpacing="1"
        fill="#5a5243"
      >
        SOLANA SAVINGS & TRUST
      </text>

      {/* Entablature with a row of dentils. */}
      <rect x="64" y="64" width="192" height="3" fill={STONE_SHADE} stroke={INK} strokeWidth="1" />
      <rect x="70" y="67" width="180" height="12" fill={STONE} stroke={INK} strokeWidth="1" />
      {Array.from({ length: 29 }, (_, i) => (
        <rect key={i} x={73 + i * 6} y="70" width="3" height="3" fill={STONE_SHADE} />
      ))}
      <rect x="71" y="75" width="178" height="1" fill={STONE_SHADE} />

      {/* Recessed wall, windows and the front door. */}
      <rect x="76" y="79" width="168" height="53" fill={WALL} />
      {WINDOWS.map((x) => (
        <g key={x}>
          <rect x={x - 1} y="93" width="10" height="24" fill={INK} />
          <rect x={x} y="94" width="8" height="22" fill={GLASS} />
          <rect x={x} y="104" width="8" height="1" fill={INK} />
          <rect x={x + 4} y="94" width="1" height="22" fill={INK} />
          <rect x={x + 1} y="95" width="2" height="4" fill="#d6ecea" />
        </g>
      ))}
      <rect x="149" y="97" width="22" height="35" fill={INK} />
      <rect x="150" y="98" width="20" height="34" fill={GREEN} />
      <rect x="159" y="98" width="2" height="34" fill={INK} />
      <rect x="156" y="114" width="2" height="2" fill={GOLD} />
      <rect x="162" y="114" width="2" height="2" fill={GOLD} />
      <rect x="152" y="101" width="5" height="9" fill="#3d7a5c" />
      <rect x="163" y="101" width="5" height="9" fill="#3d7a5c" />

      {/* Columns: capital, fluted shaft with a dithered shadow side, base. */}
      {COLUMNS.map((x) => (
        <g key={x}>
          <rect x={x} y="82" width="12" height="48" fill={STONE} stroke={INK} strokeWidth="1" />
          <rect x={x + 4} y="83" width="1" height="46" fill={STONE_SHADE} />
          <rect x={x + 7} y="83" width="1" height="46" fill={STONE_SHADE} />
          <rect x={x + 9} y="83" width="3" height="46" fill="url(#dither-shade)" />
          <rect x={x - 2} y="79" width="16" height="3" fill={STONE} stroke={INK} strokeWidth="1" />
          <rect x={x - 2} y="129" width="16" height="3" fill={STONE} stroke={INK} strokeWidth="1" />
        </g>
      ))}

      {/* Plinth and steps. */}
      <rect x="70" y="132" width="180" height="6" fill={STONE} stroke={INK} strokeWidth="1" />
      <rect x="66" y="138" width="188" height="4" fill={STEP} stroke={INK} strokeWidth="1" />
      <rect x="62" y="142" width="196" height="4" fill={STEP} stroke={INK} strokeWidth="1" />
      <rect x="58" y="146" width="204" height="4" fill={STEP} stroke={INK} strokeWidth="1" />

      <Hedge x={16} w={36} />
      <Hedge x={268} w={36} />
      <Lamp x={46} />
      <Lamp x={272} />
    </svg>
  );
}
