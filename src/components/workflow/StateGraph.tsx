import type { Definition } from "@/platform/workflow/schema";

// Layered SVG layout of a definition: states are placed by BFS depth from the initial state,
// compound states are drawn as lanes containing their branch states, edges are transitions.

interface Node {
  key: string;
  label: string;
  category: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lane?: string;
}

const W = 150;
const H = 40;
const GAP_X = 70;
const GAP_Y = 24;

function layers(def: Definition): string[][] {
  const depth = new Map<string, number>([[def.initialState, 0]]);
  const queue = [def.initialState];
  const edges = def.transitions.filter((t) => !t.branch);
  const compoundNext = new Map<string, string[]>();
  for (const s of def.states)
    if (s.compound)
      compoundNext.set(s.key, [
        s.compound.onComplete,
        ...(s.compound.onReject ? [s.compound.onReject] : []),
      ]);
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    const nexts = [
      ...edges.filter((t) => t.from === cur).map((t) => t.to),
      ...(compoundNext.get(cur) ?? []),
    ];
    for (const n of nexts) {
      if (!depth.has(n)) {
        depth.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  for (const s of def.states) if (!depth.has(s.key)) depth.set(s.key, 0);
  const out: string[][] = [];
  for (const [k, d] of depth) (out[d] ??= []).push(k);
  return out;
}

export function StateGraph({ definition }: { definition: Definition }) {
  const cols = layers(definition);
  const nodes = new Map<string, Node>();
  let maxY = 0;
  cols.forEach((col, ci) => {
    let y = 20;
    for (const key of col) {
      const s = definition.states.find((st) => st.key === key)!;
      const branches = s.compound?.branches ?? [];
      const innerCount = branches.reduce((n, b) => n + b.states.length, 0);
      const h = s.compound ? H + branches.length * 22 + innerCount * (H + 8) + 16 : H;
      nodes.set(key, {
        key,
        label: s.label,
        category: s.category,
        x: 20 + ci * (W + GAP_X),
        y,
        w: W,
        h,
      });
      if (s.compound) {
        let iy = y + H + 8;
        for (const b of branches) {
          iy += 22;
          for (const bs of b.states) {
            nodes.set(bs, {
              key: bs,
              label: bs.split(".").slice(-1)[0]!,
              category: "branch",
              x: 20 + ci * (W + GAP_X) + 10,
              y: iy,
              w: W - 20,
              h: H - 8,
              lane: b.key,
            });
            iy += H;
          }
        }
      }
      y += h + GAP_Y;
    }
    maxY = Math.max(maxY, y);
  });
  const width = 40 + cols.length * (W + GAP_X);
  const height = maxY + 20;
  const fill: Record<string, string> = {
    initial: "#dbeafe",
    active: "#dcfce7",
    waiting: "#fef9c3",
    terminal: "#e5e7eb",
    branch: "#ffffff",
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Workflow state graph"
      className="rounded-md border bg-white"
    >
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
        </marker>
      </defs>
      {definition.transitions.map((t) => {
        const a = nodes.get(t.from);
        const b = nodes.get(t.to);
        if (!a || !b) return null;
        const x1 = a.x + a.w;
        const y1 = a.y + (t.branch ? a.h / 2 : 20);
        const x2 = b.x;
        const y2 = b.y + (t.branch ? b.h / 2 : 20);
        const back = x2 <= x1;
        const path = back
          ? `M${a.x + a.w / 2},${a.y + a.h} C${a.x + a.w / 2},${a.y + a.h + 40} ${b.x + b.w / 2},${b.y + b.h + 40} ${b.x + b.w / 2},${b.y + b.h}`
          : `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}`;
        return (
          <g key={t.key}>
            <path
              d={path}
              fill="none"
              stroke={t.system ? "#94a3b8" : "#64748b"}
              strokeDasharray={t.system ? "4 3" : undefined}
              markerEnd="url(#arrow)"
            />
            <text
              x={back ? (a.x + b.x + W) / 2 : (x1 + x2) / 2}
              y={back ? Math.max(a.y + a.h, b.y + b.h) + 36 : (y1 + y2) / 2 - 4}
              fontSize="10"
              textAnchor="middle"
              fill="#334155"
            >
              {t.action}
            </text>
          </g>
        );
      })}
      {Array.from(nodes.values()).map((n) => (
        <g key={n.key}>
          <rect
            x={n.x}
            y={n.y}
            width={n.w}
            height={n.h}
            rx="6"
            fill={fill[n.category] ?? "#fff"}
            stroke="#94a3b8"
          />
          <text x={n.x + n.w / 2} y={n.y + 24} fontSize="12" textAnchor="middle" fill="#0f172a">
            {n.label}
          </text>
          {n.category !== "branch" && n.category !== "initial" ? (
            <text
              x={n.x + n.w / 2}
              y={n.y + n.h - 6}
              fontSize="9"
              textAnchor="middle"
              fill="#64748b"
            >
              {n.category === "waiting" && definition.states.find((s) => s.key === n.key)?.compound
                ? "compound"
                : n.category}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
