import { useState, useRef, useCallback, useMemo, useEffect } from "react";

// ─── ORTHOGONAL BELT ROUTER ──────────────────────────────────────────────────
// Produces a right-angle SVG path from source building edge to target edge.
// Strategy: exit right/left/top/bottom depending on relative position, route
// with a single elbow (two segments), avoid building bounding boxes with a
// clearance margin, then fall back to a 3-segment dogleg if needed.

const MARGIN = 10; // px clearance outside each building

function getBuildingRect(p) {
  const d = BUILDINGS[p.type];
  return {
    x1: p.x * CELL,
    y1: p.y * CELL,
    x2: (p.x + d.w) * CELL,
    y2: (p.y + d.h) * CELL,
  };
}

function rectCenter(r) {
  return { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
}

// Get the preferred exit/entry port pixel coords on a building's edge
function getPort(p, side) {
  const r = getBuildingRect(p);
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  if (side === "right")  return { x: r.x2, y: cy };
  if (side === "left")   return { x: r.x1, y: cy };
  if (side === "bottom") return { x: cx,   y: r.y2 };
  if (side === "top")    return { x: cx,   y: r.y1 };
  return { x: cx, y: cy };
}

// Check if a horizontal or vertical segment clips any building (except from/to)
function segClips(ax, ay, bx, by, placed, skipIds) {
  for (const p of placed) {
    if (skipIds.has(p.id)) continue;
    const r = getBuildingRect(p);
    const rx1 = r.x1 - MARGIN, rx2 = r.x2 + MARGIN;
    const ry1 = r.y1 - MARGIN, ry2 = r.y2 + MARGIN;
    if (ax === bx) {
      // vertical segment x=ax, y in [min(ay,by), max(ay,by)]
      const minY = Math.min(ay, by), maxY = Math.max(ay, by);
      if (ax >= rx1 && ax <= rx2 && maxY >= ry1 && minY <= ry2) return true;
    } else {
      // horizontal segment y=ay, x in [min(ax,bx), max(ax,bx)]
      const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
      if (ay >= ry1 && ay <= ry2 && maxX >= rx1 && minX <= rx2) return true;
    }
  }
  return false;
}

// Build polyline points for the belt path
function routeBelt(from, to, placed) {
  const skipIds = new Set([from.id, to.id]);
  const fr = getBuildingRect(from);
  const tr = getBuildingRect(to);
  const fc = rectCenter(fr);
  const tc = rectCenter(tr);

  // Decide exit side based on relative center position
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;

  let fromSide, toSide;
  if (Math.abs(dx) >= Math.abs(dy)) {
    fromSide = dx >= 0 ? "right" : "left";
    toSide   = dx >= 0 ? "left"  : "right";
  } else {
    fromSide = dy >= 0 ? "bottom" : "top";
    toSide   = dy >= 0 ? "top"    : "bottom";
  }

  const A = getPort(from, fromSide);
  const B = getPort(to,   toSide);

  // Stub offset: pull out from the building face before turning
  const STUB = CELL * 0.6;
  let Ax = A.x, Ay = A.y;
  if (fromSide === "right")  Ax += STUB;
  if (fromSide === "left")   Ax -= STUB;
  if (fromSide === "bottom") Ay += STUB;
  if (fromSide === "top")    Ay -= STUB;

  let Bx = B.x, By = B.y;
  if (toSide === "left")   Bx -= STUB;
  if (toSide === "right")  Bx += STUB;
  if (toSide === "top")    By -= STUB;
  if (toSide === "bottom") By += STUB;

  // Two-segment elbow candidates
  // Option 1: horizontal then vertical (elbow at Ax, By)
  const e1 = [A, {x:Ax,y:Ay}, {x:Ax,y:By}, {x:Bx,y:By}, B];
  // Option 2: vertical then horizontal (elbow at Bx, Ay)
  const e2 = [A, {x:Ax,y:Ay}, {x:Bx,y:Ay}, {x:Bx,y:By}, B];

  function pathClips(pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (segClips(pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y, placed, skipIds)) return true;
    }
    return false;
  }

  if (!pathClips(e1)) return e1;
  if (!pathClips(e2)) return e2;

  // Fallback: 3-segment dogleg routing around obstacles
  // Try routing above or below, left or right with clearance
  const fr2 = { x1: fr.x1-MARGIN, y1: fr.y1-MARGIN, x2: fr.x2+MARGIN, y2: fr.y2+MARGIN };
  const tr2 = { x1: tr.x1-MARGIN, y1: tr.y1-MARGIN, x2: tr.x2+MARGIN, y2: tr.y2+MARGIN };

  const detourY_above = Math.min(fr2.y1, tr2.y1) - CELL;
  const detourY_below = Math.max(fr2.y2, tr2.y2) + CELL;
  const detourX_left  = Math.min(fr2.x1, tr2.x1) - CELL;
  const detourX_right = Math.max(fr2.x2, tr2.x2) + CELL;

  const candidates = [
    [A, {x:Ax,y:Ay}, {x:Ax,y:detourY_above}, {x:Bx,y:detourY_above}, {x:Bx,y:By}, B],
    [A, {x:Ax,y:Ay}, {x:Ax,y:detourY_below}, {x:Bx,y:detourY_below}, {x:Bx,y:By}, B],
    [A, {x:Ax,y:Ay}, {x:detourX_left,y:Ay},  {x:detourX_left,y:By},  {x:Bx,y:By}, B],
    [A, {x:Ax,y:Ay}, {x:detourX_right,y:Ay}, {x:detourX_right,y:By}, {x:Bx,y:By}, B],
  ];

  for (const c of candidates) {
    if (!pathClips(c)) return c;
  }

  // Final fallback: direct elbow, clips be damned
  return e1;
}

// Convert polyline points to a smooth SVG path with rounded corners
function pointsToPath(pts, r = 8) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur  = pts[i];
    const next = pts[i + 1];
    // direction vectors
    const inDx  = cur.x - prev.x, inDy  = cur.y - prev.y;
    const outDx = next.x - cur.x, outDy = next.y - cur.y;
    const inLen  = Math.sqrt(inDx*inDx + inDy*inDy);
    const outLen = Math.sqrt(outDx*outDx + outDy*outDy);
    const actualR = Math.min(r, inLen / 2, outLen / 2);
    if (actualR < 1) { d += ` L ${cur.x} ${cur.y}`; continue; }
    const inUx = inDx/inLen, inUy = inDy/inLen;
    const outUx = outDx/outLen, outUy = outDy/outLen;
    const bx = cur.x - inUx * actualR, by = cur.y - inUy * actualR;
    const cx2 = cur.x + outUx * actualR, cy2 = cur.y + outUy * actualR;
    d += ` L ${bx} ${by} Q ${cur.x} ${cur.y} ${cx2} ${cy2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// Approximate path length for animation timing
function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x;
    const dy = pts[i].y - pts[i-1].y;
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len;
}

// Belt route component with animated flow
function BeltRoute({ conn, fromP, toP, placed, beltColor, beltMk, beltSpeed, outputRate, isSelected, onClick }) {
  const pts   = useMemo(() => routeBelt(fromP, toP, placed), [fromP, toP, placed]);
  const dPath = useMemo(() => pointsToPath(pts, 10), [pts]);
  const pLen  = useMemo(() => pathLength(pts), [pts]);
  const mid   = pts[Math.floor(pts.length / 2)];
  const animDuration = Math.max(1, pLen / 120);

  const overcap = outputRate != null && outputRate > beltSpeed;
  const trackColor = overcap ? "#ef4444" : beltColor;
  // How overloaded: 0=fine, up to 1+=very bad
  const overPct = overcap ? Math.min(1, (outputRate - beltSpeed) / beltSpeed) : 0;

  return (
    <g onClick={onClick} style={{ cursor: "pointer", pointerEvents: "stroke" }}>
      {/* Overcapacity glow */}
      {overcap && (
        <path d={dPath} fill="none" stroke="#ef4444" strokeWidth={6 + overPct * 6}
          strokeOpacity={0.25 + overPct * 0.2} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* Shadow / glow for selected */}
      {isSelected && (
        <path d={dPath} fill="none" stroke={trackColor} strokeWidth={8} opacity={0.2} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* Belt track */}
      <path d={dPath} fill="none" stroke={trackColor} strokeWidth={isSelected ? 3 : 2}
        strokeOpacity={isSelected ? 1 : 0.75} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={overcap ? "4 3" : undefined} />
      {/* Animated flow dashes */}
      <path d={dPath} fill="none" stroke="#fff" strokeWidth={1.5}
        strokeOpacity={0.35} strokeLinecap="round"
        strokeDasharray={`6 ${Math.max(10, pLen / 8)}`}
        strokeDashoffset="0">
        <animate attributeName="stroke-dashoffset"
          from="0" to={`-${pLen}`}
          dur={`${animDuration}s`} repeatCount="indefinite" />
      </path>
      {/* Badge — warning or normal Mk label */}
      <circle cx={mid.x} cy={mid.y} r={11} fill="#0d1117" stroke={trackColor} strokeWidth={1.5} />
      {overcap ? (
        <>
          <text x={mid.x} y={mid.y - 1} textAnchor="middle" fill="#ef4444" fontSize={11} fontFamily="monospace" fontWeight="bold">!</text>
          <text x={mid.x} y={mid.y + 8} textAnchor="middle" fill="#ef4444" fontSize={6} fontFamily="monospace">{Math.round(outputRate)}</text>
        </>
      ) : (
        <text x={mid.x} y={mid.y + 3.5} textAnchor="middle" fill={beltColor}
          fontSize={9} fontFamily="monospace" fontWeight="bold">{beltMk}</text>
      )}
    </g>
  );
}

const CELL = 48;

const BUILDINGS = {
  miner_mk1:  { label:"Miner Mk.1",  cat:"extraction", w:1,h:2,color:"#b45309",inputs:0,outputs:1,baseOutput:60, icon:"⛏" },
  miner_mk2:  { label:"Miner Mk.2",  cat:"extraction", w:1,h:2,color:"#d97706",inputs:0,outputs:1,baseOutput:120,icon:"⛏" },
  miner_mk3:  { label:"Miner Mk.3",  cat:"extraction", w:1,h:2,color:"#f59e0b",inputs:0,outputs:1,baseOutput:240,icon:"⛏" },
  oil_extractor:   {label:"Oil Extractor",   cat:"extraction",w:2,h:3,color:"#6b21a8",inputs:0,outputs:1,icon:"🛢"},
  water_extractor: {label:"Water Extractor", cat:"extraction",w:3,h:3,color:"#1d4ed8",inputs:0,outputs:1,icon:"💧"},
  resource_well:   {label:"Resource Well",   cat:"extraction",w:1,h:1,color:"#0e7490",inputs:0,outputs:1,icon:"♨"},
  smelter:     {label:"Smelter",     cat:"production",w:1,h:2,color:"#dc2626",inputs:1,outputs:1,power:4,   icon:"🔥"},
  foundry:     {label:"Foundry",     cat:"production",w:2,h:2,color:"#b91c1c",inputs:2,outputs:1,power:16,  icon:"🏭"},
  constructor: {label:"Constructor", cat:"production",w:1,h:2,color:"#16a34a",inputs:1,outputs:1,power:4,   icon:"🔧"},
  assembler:   {label:"Assembler",   cat:"production",w:2,h:2,color:"#15803d",inputs:2,outputs:1,power:15,  icon:"⚙"},
  manufacturer:{label:"Manufacturer",cat:"production",w:3,h:3,color:"#166534",inputs:4,outputs:1,power:55,  icon:"🏗"},
  refinery:    {label:"Refinery",    cat:"production",w:2,h:3,color:"#7c3aed",inputs:2,outputs:2,power:30,  icon:"🧪"},
  blender:     {label:"Blender",     cat:"production",w:3,h:2,color:"#6d28d9",inputs:4,outputs:2,power:75,  icon:"⚗"},
  packager:    {label:"Packager",    cat:"production",w:1,h:1,color:"#0891b2",inputs:2,outputs:2,power:10,  icon:"📦"},
  particle_acc:{label:"Particle Accel.",cat:"production",w:3,h:5,color:"#4f46e5",inputs:4,outputs:2,power:500,icon:"⚡"},
  quantum_enc: {label:"Quantum Encoder",cat:"production",w:3,h:4,color:"#7c3aed",inputs:4,outputs:2,power:1000,icon:"🔮"},
  converter:   {label:"Converter",   cat:"production",w:2,h:3,color:"#0f766e",inputs:2,outputs:1,power:200, icon:"♻"},
  splitter:        {label:"Splitter",        cat:"logistics",w:1,h:1,color:"#64748b",inputs:1,outputs:3,icon:"⑂"},
  smart_split:     {label:"Smart Splitter",  cat:"logistics",w:1,h:1,color:"#475569",inputs:1,outputs:3,icon:"⑃"},
  prog_split:      {label:"Prog. Splitter",  cat:"logistics",w:1,h:1,color:"#334155",inputs:1,outputs:3,icon:"⑄"},
  merger:          {label:"Merger",          cat:"logistics",w:1,h:1,color:"#64748b",inputs:3,outputs:1,icon:"⑁"},
  priority_merger: {label:"Priority Merger", cat:"logistics",w:1,h:1,color:"#475569",inputs:3,outputs:1,icon:"⇈"},
  storage_sm:  {label:"Storage Cont.",      cat:"storage",w:1,h:2,color:"#92400e",inputs:1,outputs:1,icon:"📫"},
  storage_ind: {label:"Industrial Storage", cat:"storage",w:1,h:2,color:"#78350f",inputs:2,outputs:2,icon:"🗄"},
  fluid_buffer:{label:"Fluid Buffer",       cat:"storage",w:1,h:1,color:"#0369a1",inputs:1,outputs:1,icon:"🫙"},
  ind_fluid:   {label:"Ind. Fluid Buffer",  cat:"storage",w:2,h:2,color:"#075985",inputs:2,outputs:2,icon:"🛢"},
  biomass:     {label:"Biomass Burner",cat:"power",w:1,h:1,color:"#65a30d",inputs:1,outputs:0,power:-30,  icon:"🌿"},
  coal_gen:    {label:"Coal Generator",cat:"power",w:2,h:4,color:"#374151",inputs:1,outputs:0,power:-75,  icon:"⚡"},
  fuel_gen:    {label:"Fuel Generator",cat:"power",w:3,h:3,color:"#1d4ed8",inputs:1,outputs:0,power:-250, icon:"⛽"},
  nuclear:     {label:"Nuclear Plant", cat:"power",w:5,h:6,color:"#14532d",inputs:2,outputs:1,power:-2500,icon:"☢"},
  awesome_sink:{label:"AWESOME Sink",  cat:"power",w:2,h:2,color:"#b45309",inputs:1,outputs:0,           icon:"🌀"},
  space_elevator:{label:"Space Elevator",cat:"special",w:7,h:7,color:"#1e3a8a",inputs:0,outputs:0,icon:"🚀"},
  hub:           {label:"The HUB",       cat:"special",w:2,h:4,color:"#1e3a8a",inputs:0,outputs:0,icon:"🏠"},
};

const BELT_MARKS = [
  {mk:1,speed:60,  color:"#ef4444"},
  {mk:2,speed:120, color:"#f97316"},
  {mk:3,speed:270, color:"#eab308"},
  {mk:4,speed:480, color:"#22c55e"},
  {mk:5,speed:780, color:"#3b82f6"},
  {mk:6,speed:1200,color:"#a855f7"},
];

// Miner node configuration
const MINER_RESOURCES = [
  "Iron Ore","Copper Ore","Limestone","Coal","Caterium Ore",
  "Raw Quartz","Sulfur","Bauxite","Uranium","SAM Ore",
];
const PURITY = [
  { id:"impure", label:"Impure", mult:0.5, color:"#f87171" },
  { id:"normal", label:"Normal", mult:1.0, color:"#fbbf24" },
  { id:"pure",   label:"Pure",   mult:2.0, color:"#4ade80" },
];
const MINER_TYPES = new Set(["miner_mk1","miner_mk2","miner_mk3"]);

function minerOutputRate(building, clock) {
  const base = BUILDINGS[building]?.baseOutput || 60;
  const pMult = PURITY.find(p => p.id === "normal")?.mult || 1;
  return base * pMult * (clock / 100);
}
function minerOutputRateFull(building, purityId, clock) {
  const base = BUILDINGS[building]?.baseOutput || 60;
  const pMult = PURITY.find(p => p.id === purityId)?.mult ?? 1;
  return base * pMult * (clock / 100);
}

// Returns output items/min for a placed building, or null if unknown
function getBuildingOutputRate(p) {
  if (MINER_TYPES.has(p.type)) {
    return minerOutputRateFull(p.type, p.nodePurity || "normal", p.clock);
  }
  if (p.recipe && RECIPES[p.recipe]) {
    return RECIPES[p.recipe].rate * (p.clock / 100);
  }
  return null;
}

const RECIPES = {
  iron_ingot:       {out:"Iron Ingot",              rate:30,   bld:"smelter",      ins:[{i:"Iron Ore",rate:30}]},
  copper_ingot:     {out:"Copper Ingot",            rate:30,   bld:"smelter",      ins:[{i:"Copper Ore",rate:30}]},
  caterium_ingot:   {out:"Caterium Ingot",          rate:15,   bld:"smelter",      ins:[{i:"Caterium Ore",rate:45}]},
  steel_ingot:      {out:"Steel Ingot",             rate:45,   bld:"foundry",      ins:[{i:"Iron Ore",rate:45},{i:"Coal",rate:45}]},
  aluminum_ingot:   {out:"Aluminum Ingot",          rate:60,   bld:"foundry",      ins:[{i:"Aluminum Scrap",rate:90},{i:"Silica",rate:75}]},
  iron_rod:         {out:"Iron Rod",                rate:15,   bld:"constructor",  ins:[{i:"Iron Ingot",rate:15}]},
  iron_plate:       {out:"Iron Plate",              rate:20,   bld:"constructor",  ins:[{i:"Iron Ingot",rate:30}]},
  wire:             {out:"Wire",                    rate:30,   bld:"constructor",  ins:[{i:"Copper Ingot",rate:15}]},
  cable:            {out:"Cable",                   rate:30,   bld:"constructor",  ins:[{i:"Wire",rate:60}]},
  screw:            {out:"Screw",                   rate:40,   bld:"constructor",  ins:[{i:"Iron Rod",rate:10}]},
  concrete:         {out:"Concrete",                rate:15,   bld:"constructor",  ins:[{i:"Limestone",rate:45}]},
  quartz_crystal:   {out:"Quartz Crystal",          rate:22.5, bld:"constructor",  ins:[{i:"Raw Quartz",rate:37.5}]},
  silica:           {out:"Silica",                  rate:37.5, bld:"constructor",  ins:[{i:"Raw Quartz",rate:22.5}]},
  copper_sheet:     {out:"Copper Sheet",            rate:10,   bld:"constructor",  ins:[{i:"Copper Ingot",rate:20}]},
  steel_beam:       {out:"Steel Beam",              rate:15,   bld:"constructor",  ins:[{i:"Steel Ingot",rate:60}]},
  steel_pipe:       {out:"Steel Pipe",              rate:20,   bld:"constructor",  ins:[{i:"Steel Ingot",rate:30}]},
  empty_canister:   {out:"Empty Canister",          rate:60,   bld:"constructor",  ins:[{i:"Plastic",rate:30}]},
  quickwire:        {out:"Quickwire",               rate:60,   bld:"constructor",  ins:[{i:"Caterium Ingot",rate:12}]},
  aluminum_casing:  {out:"Aluminum Casing",         rate:60,   bld:"constructor",  ins:[{i:"Aluminum Ingot",rate:90}]},
  reinforced_plate: {out:"Reinforced Iron Plate",   rate:5,    bld:"assembler",    ins:[{i:"Iron Plate",rate:30},{i:"Screw",rate:60}]},
  rotor:            {out:"Rotor",                   rate:4,    bld:"assembler",    ins:[{i:"Iron Rod",rate:20},{i:"Screw",rate:100}]},
  modular_frame:    {out:"Modular Frame",           rate:2,    bld:"assembler",    ins:[{i:"Reinforced Iron Plate",rate:3},{i:"Iron Rod",rate:12}]},
  smart_plating:    {out:"Smart Plating",           rate:2,    bld:"assembler",    ins:[{i:"Reinforced Iron Plate",rate:2},{i:"Rotor",rate:2}]},
  versatile_frame:  {out:"Versatile Framework",     rate:5,    bld:"assembler",    ins:[{i:"Modular Frame",rate:2.5},{i:"Steel Beam",rate:30}]},
  encased_beam:     {out:"Encased Industrial Beam", rate:6,    bld:"assembler",    ins:[{i:"Steel Beam",rate:24},{i:"Concrete",rate:30}]},
  stator:           {out:"Stator",                  rate:5,    bld:"assembler",    ins:[{i:"Steel Pipe",rate:15},{i:"Wire",rate:40}]},
  motor:            {out:"Motor",                   rate:5,    bld:"assembler",    ins:[{i:"Rotor",rate:10},{i:"Stator",rate:10}]},
  circuit_board:    {out:"Circuit Board",           rate:7.5,  bld:"assembler",    ins:[{i:"Copper Sheet",rate:15},{i:"Plastic",rate:30}]},
  ai_limiter:       {out:"AI Limiter",              rate:5,    bld:"assembler",    ins:[{i:"Copper Sheet",rate:25},{i:"Quickwire",rate:100}]},
  alclad_sheet:     {out:"Alclad Aluminum Sheet",   rate:30,   bld:"assembler",    ins:[{i:"Aluminum Ingot",rate:30},{i:"Copper Ingot",rate:10}]},
  heat_sink:        {out:"Heat Sink",               rate:7.5,  bld:"assembler",    ins:[{i:"Alclad Aluminum Sheet",rate:37.5},{i:"Copper Sheet",rate:22.5}]},
  computer:         {out:"Computer",                rate:2.5,  bld:"manufacturer", ins:[{i:"Circuit Board",rate:10},{i:"Cable",rate:20},{i:"Plastic",rate:40},{i:"Screw",rate:130}]},
  heavy_frame:      {out:"Heavy Modular Frame",     rate:2,    bld:"manufacturer", ins:[{i:"Modular Frame",rate:10},{i:"Steel Pipe",rate:30},{i:"Encased Industrial Beam",rate:10},{i:"Screw",rate:200}]},
  modular_engine:   {out:"Modular Engine",          rate:1,    bld:"manufacturer", ins:[{i:"Motor",rate:2},{i:"Rubber",rate:15},{i:"Smart Plating",rate:2}]},
  supercomputer:    {out:"Supercomputer",           rate:1.875,bld:"manufacturer", ins:[{i:"Computer",rate:3.75},{i:"AI Limiter",rate:3.75},{i:"High-Speed Connector",rate:5.625},{i:"Plastic",rate:52.5}]},
  turbo_motor:      {out:"Turbo Motor",             rate:1.875,bld:"manufacturer", ins:[{i:"Cooling System",rate:7.5},{i:"Radio Control Unit",rate:3.75},{i:"Motor",rate:7.5},{i:"Rubber",rate:45}]},
  battery:          {out:"Battery",                 rate:20,   bld:"blender",      ins:[{i:"Sulfuric Acid",rate:50},{i:"Alumina Solution",rate:40},{i:"Aluminum Casing",rate:20}]},
  cooling_system:   {out:"Cooling System",          rate:6,    bld:"blender",      ins:[{i:"Heat Sink",rate:12},{i:"Rubber",rate:12},{i:"Water",rate:30},{i:"Nitrogen Gas",rate:150}]},
  fused_frame:      {out:"Fused Modular Frame",     rate:1.5,  bld:"blender",      ins:[{i:"Heavy Modular Frame",rate:1.5},{i:"Aluminum Casing",rate:75},{i:"Nitrogen Gas",rate:37.5}]},
  plastic:          {out:"Plastic",                 rate:20,   bld:"refinery",     ins:[{i:"Crude Oil",rate:30}]},
  rubber:           {out:"Rubber",                  rate:20,   bld:"refinery",     ins:[{i:"Crude Oil",rate:30}]},
  fuel:             {out:"Fuel",                    rate:40,   bld:"refinery",     ins:[{i:"Crude Oil",rate:60}]},
  turbofuel:        {out:"Turbofuel",               rate:18.75,bld:"refinery",     ins:[{i:"Fuel",rate:22.5},{i:"Compacted Coal",rate:15}]},
  aluminum_solution:{out:"Alumina Solution",        rate:120,  bld:"refinery",     ins:[{i:"Bauxite",rate:120},{i:"Water",rate:180}]},
  aluminum_scrap:   {out:"Aluminum Scrap",          rate:360,  bld:"refinery",     ins:[{i:"Alumina Solution",rate:240},{i:"Coal",rate:120}]},
  sulfuric_acid:    {out:"Sulfuric Acid",           rate:50,   bld:"refinery",     ins:[{i:"Sulfur",rate:50},{i:"Water",rate:50}]},
  nitric_acid:      {out:"Nitric Acid",             rate:30,   bld:"blender",      ins:[{i:"Nitrogen Gas",rate:120},{i:"Water",rate:30},{i:"Iron Plate",rate:10}]},
  encased_uranium:  {out:"Encased Uranium Cell",    rate:25,   bld:"blender",      ins:[{i:"Uranium",rate:50},{i:"Concrete",rate:15},{i:"Sulfuric Acid",rate:40}]},

  // ── Alternate Recipes ─────────────────────────────────────────────────────
  // Smelter alts
  alt_pure_iron:        {out:"Iron Ingot",         rate:65,   bld:"refinery",     ins:[{i:"Iron Ore",rate:35},{i:"Water",rate:20}],                                    alt:true, altName:"Pure Iron Ingot"},
  alt_iron_alloy:       {out:"Iron Ingot",         rate:50,   bld:"foundry",      ins:[{i:"Iron Ore",rate:20},{i:"Copper Ore",rate:20}],                               alt:true, altName:"Iron Alloy Ingot"},
  alt_pure_copper:      {out:"Copper Ingot",       rate:100,  bld:"refinery",     ins:[{i:"Copper Ore",rate:15},{i:"Water",rate:10}],                                  alt:true, altName:"Pure Copper Ingot"},
  alt_copper_alloy:     {out:"Copper Ingot",       rate:100,  bld:"foundry",      ins:[{i:"Copper Ore",rate:50},{i:"Gold Ore",rate:25}],                               alt:true, altName:"Copper Alloy Ingot"},
  alt_pure_caterium:    {out:"Caterium Ingot",     rate:30,   bld:"refinery",     ins:[{i:"Caterium Ore",rate:24},{i:"Water",rate:24}],                                alt:true, altName:"Pure Caterium Ingot"},
  alt_leached_caterium: {out:"Caterium Ingot",     rate:36,   bld:"blender",      ins:[{i:"Caterium Ore",rate:54},{i:"Sulfuric Acid",rate:30}],                        alt:true, altName:"Leached Caterium Ingot"},
  alt_solid_steel:      {out:"Steel Ingot",        rate:60,   bld:"constructor",  ins:[{i:"Iron Ingot",rate:40},{i:"Coal",rate:40}],                                   alt:true, altName:"Solid Steel Ingot"},
  alt_compacted_steel:  {out:"Steel Ingot",        rate:37.5, bld:"foundry",      ins:[{i:"Iron Ore",rate:22.5},{i:"Compacted Coal",rate:11.25}],                      alt:true, altName:"Compacted Steel Ingot"},
  alt_coke_steel:       {out:"Steel Ingot",        rate:100,  bld:"foundry",      ins:[{i:"Iron Ore",rate:75},{i:"Petroleum Coke",rate:75}],                           alt:true, altName:"Coke Steel Ingot"},
  alt_tempered_caterium:{out:"Caterium Ingot",     rate:7.5,  bld:"foundry",      ins:[{i:"Caterium Ore",rate:6},{i:"Quickwire",rate:60}],                             alt:true, altName:"Tempered Caterium Ingot"},

  // Constructor alts
  alt_iron_wire:        {out:"Wire",               rate:22.5, bld:"constructor",  ins:[{i:"Iron Ingot",rate:12.5}],                                                   alt:true, altName:"Iron Wire"},
  alt_caterium_wire:    {out:"Wire",               rate:120,  bld:"constructor",  ins:[{i:"Caterium Ingot",rate:15}],                                                 alt:true, altName:"Fused Wire"},
  alt_rubber_wire:      {out:"Wire",               rate:90,   bld:"refinery",     ins:[{i:"Rubber",rate:30}],                                                         alt:true, altName:"Rubber Wire"},
  alt_iron_cable:       {out:"Cable",              rate:20,   bld:"constructor",  ins:[{i:"Wire",rate:37.5}],                                                         alt:true, altName:"Coated Cable"},
  alt_quickwire_cable:  {out:"Cable",              rate:27.5, bld:"assembler",    ins:[{i:"Quickwire",rate:7.5},{i:"Rubber",rate:5}],                                  alt:true, altName:"Quickwire Cable"},
  alt_steeled_frame:    {out:"Modular Frame",      rate:3,    bld:"assembler",    ins:[{i:"Reinforced Iron Plate",rate:2},{i:"Steel Pipe",rate:10}],                   alt:true, altName:"Steeled Frame"},
  alt_bolted_frame:     {out:"Modular Frame",      rate:5,    bld:"assembler",    ins:[{i:"Reinforced Iron Plate",rate:7.5},{i:"Screw",rate:140}],                     alt:true, altName:"Bolted Frame"},
  alt_stitched_plate:   {out:"Reinforced Iron Plate",rate:3.75,bld:"assembler",   ins:[{i:"Iron Plate",rate:18.75},{i:"Wire",rate:37.5}],                              alt:true, altName:"Stitched Iron Plate"},
  alt_bolted_plate:     {out:"Reinforced Iron Plate",rate:15, bld:"assembler",    ins:[{i:"Iron Plate",rate:90},{i:"Screw",rate:250}],                                 alt:true, altName:"Bolted Iron Plate"},
  alt_adhered_frame:    {out:"Reinforced Iron Plate",rate:1,  bld:"manufacturer", ins:[{i:"Iron Plate",rate:11.25},{i:"Rubber",rate:3.75},{i:"Screw",rate:46.875}],    alt:true, altName:"Adhered Iron Plate"},
  alt_cheap_silica:     {out:"Silica",             rate:52.5, bld:"assembler",    ins:[{i:"Raw Quartz",rate:22.5},{i:"Limestone",rate:37.5}],                          alt:true, altName:"Cheap Silica"},
  alt_steel_rod:        {out:"Iron Rod",           rate:48,   bld:"constructor",  ins:[{i:"Steel Ingot",rate:12}],                                                    alt:true, altName:"Steel Rod"},
  alt_aluminum_rod:     {out:"Iron Rod",           rate:7.5,  bld:"assembler",    ins:[{i:"Aluminum Ingot",rate:1},{i:"Silica",rate:1.5}],                             alt:true, altName:"Aluminum Rod"},
  alt_cast_screw:       {out:"Screw",              rate:54,   bld:"constructor",  ins:[{i:"Steel Ingot",rate:5}],                                                     alt:true, altName:"Cast Screw"},
  alt_steel_screw:      {out:"Screw",              rate:260,  bld:"constructor",  ins:[{i:"Steel Beam",rate:5}],                                                      alt:true, altName:"Steel Screw"},
  alt_copper_rotor:     {out:"Rotor",              rate:11.25,bld:"assembler",    ins:[{i:"Copper Sheet",rate:22.5},{i:"Screw",rate:195}],                             alt:true, altName:"Copper Rotor"},
  alt_steel_rotor:      {out:"Rotor",              rate:5,    bld:"assembler",    ins:[{i:"Steel Pipe",rate:10},{i:"Wire",rate:30}],                                   alt:true, altName:"Steel Rotor"},

  // Assembler alts
  alt_crystal_comp:     {out:"Circuit Board",      rate:8.75, bld:"assembler",    ins:[{i:"Rubber",rate:27.5},{i:"Quartz Crystal",rate:11.25}],                        alt:true, altName:"Crystal Computer"},
  alt_silicon_board:    {out:"Circuit Board",      rate:5,    bld:"assembler",    ins:[{i:"Copper Ingot",rate:25},{i:"Silica",rate:40}],                               alt:true, altName:"Silicon Circuit Board"},
  alt_caterium_motor:   {out:"Motor",              rate:7.5,  bld:"assembler",    ins:[{i:"Quickwire",rate:75},{i:"Rotor",rate:3.75}],                                 alt:true, altName:"Caterium Motor"},
  alt_electric_motor:   {out:"Motor",              rate:7.5,  bld:"assembler",    ins:[{i:"Electromagnetic Control Rod",rate:3.75},{i:"Rotor",rate:7.5}],              alt:true, altName:"Electric Motor"},

  // Manufacturer alts
  alt_oc_computer:      {out:"Computer",           rate:3.8,  bld:"manufacturer", ins:[{i:"Circuit Board",rate:10},{i:"Quickwire",rate:52.5},{i:"Rubber",rate:22.5}],  alt:true, altName:"OC Supercomputer"},
  alt_super_supercomp:  {out:"Supercomputer",      rate:2.4,  bld:"manufacturer", ins:[{i:"Radio Control Unit",rate:9},{i:"AI Limiter",rate:18}],                      alt:true, altName:"Super-State Computer"},
  alt_heavy_encased:    {out:"Heavy Modular Frame", rate:3,   bld:"manufacturer", ins:[{i:"Modular Frame",rate:7.5},{i:"Encased Industrial Beam",rate:9.375},{i:"Steel Pipe",rate:33.75},{i:"Concrete",rate:20.625}], alt:true, altName:"Heavy Encased Frame"},

  // Refinery / Blender alts
  alt_diluted_fuel:     {out:"Fuel",               rate:100,  bld:"blender",      ins:[{i:"Heavy Oil Residue",rate:50},{i:"Water",rate:100}],                          alt:true, altName:"Diluted Fuel"},
  alt_turbo_heavy:      {out:"Turbofuel",          rate:30,   bld:"blender",      ins:[{i:"Heavy Oil Residue",rate:37.5},{i:"Compacted Coal",rate:30}],                alt:true, altName:"Turbo Heavy Fuel"},
  alt_turbo_blend:      {out:"Turbofuel",          rate:45,   bld:"blender",      ins:[{i:"Fuel",rate:15},{i:"Heavy Oil Residue",rate:30},{i:"Sulfur",rate:22.5},{i:"Petroleum Coke",rate:22.5}], alt:true, altName:"Turbo Blend Fuel"},
  alt_wet_concrete:     {out:"Concrete",           rate:80,   bld:"refinery",     ins:[{i:"Limestone",rate:120},{i:"Water",rate:100}],                                 alt:true, altName:"Wet Concrete"},
  alt_fine_concrete:    {out:"Concrete",           rate:25,   bld:"assembler",    ins:[{i:"Silica",rate:7.5},{i:"Limestone",rate:30}],                                 alt:true, altName:"Fine Concrete"},
  alt_electrode_scrap:  {out:"Aluminum Scrap",     rate:300,  bld:"refinery",     ins:[{i:"Alumina Solution",rate:180},{i:"Petroleum Coke",rate:60}],                  alt:true, altName:"Electrode Aluminum Scrap"},
  alt_instant_scrap:    {out:"Aluminum Scrap",     rate:300,  bld:"blender",      ins:[{i:"Bauxite",rate:150},{i:"Coal",rate:100},{i:"Sulfuric Acid",rate:50},{i:"Water",rate:60}], alt:true, altName:"Instant Scrap"},
  alt_pure_aluminum:    {out:"Aluminum Ingot",     rate:30,   bld:"constructor",  ins:[{i:"Aluminum Scrap",rate:60}],                                                  alt:true, altName:"Pure Aluminum Ingot"},
  alt_slurry_scrap:     {out:"Aluminum Scrap",     rate:20,   bld:"refinery",     ins:[{i:"Coal",rate:10}],                                                            alt:true, altName:"Sloppy Alumina"},
};

// Build a lookup by output item name
const BY_OUTPUT = {};
for (const [key, r] of Object.entries(RECIPES)) BY_OUTPUT[r.out] = { key, ...r };

// Items with no recipe → treated as raw inputs
const RAW = new Set([
  "Iron Ore","Copper Ore","Limestone","Coal","Caterium Ore","Raw Quartz",
  "Sulfur","Bauxite","Uranium","Crude Oil","Water","Nitrogen Gas",
  "Compacted Coal","SAM Ore","Heavy Oil Residue",
]);

const CATEGORIES = ["extraction","production","logistics","storage","power","special"];
const CAT_LABELS = {extraction:"Extraction",production:"Production",logistics:"Logistics",storage:"Storage",power:"Power",special:"Special"};

// ─── Engine ──────────────────────────────────────────────────────────────────

function calcPower(base, clock) {
  return base * Math.pow(clock / 100, 1.321928);
}

function beltForRate(rate) {
  return BELT_MARKS.find(b => b.speed >= rate) || BELT_MARKS[5];
}

function solveChain(targetItem, targetRate) {
  // key = "buildingType|item"
  const bldMap = {};
  const rawMap = {};

  function visit(item, needed) {
    if (RAW.has(item) || !BY_OUTPUT[item]) {
      rawMap[item] = (rawMap[item] || 0) + needed;
      return;
    }
    const r = BY_OUTPUT[item];
    const mult = needed / r.rate;
    const key = r.bld + "|" + r.out;
    if (!bldMap[key]) {
      bldMap[key] = { bldKey: r.bld, item: r.out, exact: 0, outRate: 0 };
    }
    bldMap[key].exact += mult;
    bldMap[key].outRate += needed;
    for (const inp of r.ins) visit(inp.i, inp.rate * mult);
  }

  visit(targetItem, targetRate);
  return {
    buildings: Object.values(bldMap).sort((a, b) => a.bldKey.localeCompare(b.bldKey)),
    raws: rawMap,
  };
}

// ─── Ratio Calculator component ──────────────────────────────────────────────

function RatioCalculator() {
  const [query, setQuery]       = useState("");
  const [rate, setRate]         = useState(30);
  const [result, setResult]     = useState(null);
  const [showFrac, setShowFrac] = useState(false);
  const [showSugg, setShowSugg] = useState(false);

  const allItems = useMemo(() => Object.values(RECIPES).map(r => r.out).sort(), []);
  const suggestions = useMemo(() =>
    query.length > 0 ? allItems.filter(i => i.toLowerCase().includes(query.toLowerCase())).slice(0, 7) : [],
    [query, allItems]);

  const exactMatch = allItems.find(i => i.toLowerCase() === query.toLowerCase());

  const compute = () => {
    if (!exactMatch) return;
    setResult(solveChain(exactMatch, rate));
    setShowSugg(false);
  };

  const pick = (item) => { setQuery(item); setResult(null); setShowSugg(false); };

  const totalPowerMW = result
    ? result.buildings.reduce((s, b) => {
        const p = BUILDINGS[b.bldKey]?.power;
        return s + (p && p > 0 ? calcPower(p, 100) * b.exact : 0);
      }, 0)
    : 0;

  return (
    <div style={{ padding:"10px 12px" }}>

      {/* Target item */}
      <div style={{ marginBottom:9, position:"relative" }}>
        <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:4 }}>TARGET ITEM</div>
        <input type="text" placeholder="e.g. Motor, Computer…" value={query}
          onChange={e => { setQuery(e.target.value); setResult(null); setShowSugg(true); }}
          onFocus={() => setShowSugg(true)}
          style={{ width:"100%", boxSizing:"border-box" }} />
        {showSugg && suggestions.length > 0 && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#0d1117", border:"1px solid #2a3040", borderRadius:"0 0 4px 4px", zIndex:20, maxHeight:180, overflowY:"auto" }}>
            {suggestions.map(s => (
              <div key={s} onMouseDown={() => pick(s)}
                style={{ padding:"5px 9px", fontSize:11, color:"#c9d1d9", cursor:"pointer", borderBottom:"1px solid #131b26" }}
                onMouseEnter={e => e.currentTarget.style.background="#1c2333"}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rate */}
      <div style={{ marginBottom:9 }}>
        <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:4 }}>OUTPUT RATE (/min)</div>
        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
          <input type="number" min={0.1} step={0.5} value={rate}
            onChange={e => { setRate(+e.target.value); setResult(null); }}
            style={{ flex:1 }} />
          {[15,30,60,120,240].map(v => (
            <button key={v} onMouseDown={() => { setRate(v); setResult(null); }}
              style={{ padding:"3px 5px", background: rate===v?"#1e3a20":"#0a0e14", border:`1px solid ${rate===v?"#4ade80":"#2a3040"}`, color:rate===v?"#4ade80":"#8b949e", fontSize:8, borderRadius:3, cursor:"pointer" }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Options */}
      <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:"#8b949e", cursor:"pointer", marginBottom:10 }}>
        <input type="checkbox" checked={showFrac} onChange={e => setShowFrac(e.target.checked)} style={{ accentColor:"#f0a500" }} />
        Show exact decimal counts
      </label>

      {/* Calculate button */}
      <button onClick={compute} disabled={!exactMatch}
        style={{ width:"100%", padding:"8px 0", background: exactMatch?"#0d2010":"#0a0e14", border:`1px solid ${exactMatch?"#16a34a":"#2a3040"}`, color:exactMatch?"#4ade80":"#4a5568", fontSize:11, borderRadius:3, cursor:exactMatch?"pointer":"default", letterSpacing:1, fontFamily:"inherit", marginBottom:14 }}>
        ▶ CALCULATE CHAIN
      </button>

      {/* ── RESULTS ── */}
      {result && (
        <div>
          {/* Header summary */}
          <div style={{ padding:"9px 10px", background:"#0a0e14", border:"1px solid #1c2333", borderRadius:4, marginBottom:12 }}>
            <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:14, fontWeight:700, color:"#f0a500", marginBottom:5 }}>
              {exactMatch} @ {rate}/min
            </div>
            <div style={{ display:"flex", gap:16, fontSize:10 }}>
              <div><span style={{ color:"#4a5568" }}>Total buildings </span>
                <span style={{ color:"#c9d1d9", fontWeight:600 }}>{result.buildings.reduce((s,b)=>s+Math.ceil(b.exact),0)}</span>
              </div>
              <div><span style={{ color:"#4a5568" }}>Power </span>
                <span style={{ color:"#f87171", fontWeight:600 }}>{totalPowerMW.toFixed(0)} MW</span>
              </div>
            </div>
          </div>

          {/* Per-building rows */}
          <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:6 }}>BUILDINGS NEEDED</div>
          {result.buildings.map((b, idx) => {
            const bdef  = BUILDINGS[b.bldKey];
            const exact = b.exact;
            const count = Math.ceil(exact);
            const eff   = exact / count * 100;
            const belt  = beltForRate(b.outRate);
            const powerEach = bdef?.power && bdef.power > 0 ? calcPower(bdef.power, 100) : 0;
            const powerTotal = powerEach * exact;
            const fullRun = Math.floor(exact);
            const fracRun = exact - fullRun;

            return (
              <div key={idx} style={{ marginBottom:6, padding:"9px 10px", background:"#0a0e14", border:`1px solid ${(bdef?.color||"#888")}33`, borderLeft:`3px solid ${bdef?.color||"#888"}`, borderRadius:4 }}>

                {/* Title row */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                    <span style={{ fontSize:17 }}>{bdef?.icon||"🏭"}</span>
                    <div>
                      <div style={{ fontSize:12, color:"#c9d1d9", fontWeight:600 }}>{bdef?.label||b.bldKey}</div>
                      <div style={{ fontSize:9, color:"#8b949e" }}>→ {b.item}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:20, color:bdef?.color||"#888", fontFamily:"'Rajdhani',sans-serif", fontWeight:700, lineHeight:1 }}>{count}</div>
                    <div style={{ fontSize:10, color:"#4a5568" }}>buildings</div>
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 8px", fontSize:9 }}>
                  <span style={{ color:"#4a5568" }}>Output: <span style={{ color:"#c9d1d9" }}>{b.outRate.toFixed(1)}/min</span></span>
                  <span style={{ color:"#4a5568" }}>Efficiency: <span style={{ color: eff>99.9?"#4ade80":eff>74?"#f0a500":"#f87171" }}>{eff.toFixed(1)}%</span></span>
                  {showFrac && <span style={{ color:"#4a5568" }}>Exact: <span style={{ color:"#8b949e" }}>{exact.toFixed(4)}</span></span>}
                  {powerTotal>0 && <span style={{ color:"#4a5568" }}>Power: <span style={{ color:"#f87171" }}>{powerTotal.toFixed(0)} MW</span></span>}
                  <span style={{ color:"#4a5568" }}>Belt out: <span style={{ color:belt.color }}>Mk.{belt.mk} ({belt.speed}/min)</span></span>
                  <span style={{ color:"#4a5568" }}>Size: <span style={{ color:"#8b949e" }}>{bdef?.w||1}×{bdef?.h||1} found.</span></span>
                </div>

                {/* Underclock tip */}
                {count > exact && (() => {
                  if (count === 1) {
                    return (
                      <div style={{ marginTop:6, padding:"4px 7px", background:"#1a1200", border:"1px solid #92400e", borderRadius:3, fontSize:9, color:"#fbbf24" }}>
                        💡 Underclock 1× to {(exact*100).toFixed(1)}% for exact rate
                      </div>
                    );
                  }
                  if (fracRun > 0.005) {
                    return (
                      <div style={{ marginTop:6, padding:"4px 7px", background:"#1a1200", border:"1px solid #92400e", borderRadius:3, fontSize:9, color:"#fbbf24" }}>
                        💡 {fullRun}× at 100% + 1× at {(fracRun*100).toFixed(1)}%
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}

          {/* Raw resources */}
          {Object.keys(result.raws).length > 0 && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:6 }}>RAW INPUTS REQUIRED</div>
              {Object.entries(result.raws).sort((a,b)=>b[1]-a[1]).map(([item, r]) => {
                const belt = beltForRate(r);
                return (
                  <div key={item} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 8px", marginBottom:3, background:"#0a0e14", border:"1px solid #1c2333", borderRadius:3 }}>
                    <span style={{ fontSize:10, color:"#8b949e" }}>{item}</span>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span style={{ fontSize:12, color:"#c9d1d9" }}>{r.toFixed(1)}/min</span>
                      <span style={{ fontSize:8, color:belt.color, background:belt.color+"22", padding:"1px 5px", borderRadius:3 }}>Mk.{belt.mk}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Power summary */}
          <div style={{ marginTop:12, padding:"10px", background:"#120808", border:"1px solid #7f1d1d", borderRadius:4 }}>
            <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:4 }}>TOTAL POWER DRAW</div>
            <div style={{ fontSize:22, color:"#f87171", fontFamily:"'Rajdhani',sans-serif", fontWeight:700, marginBottom:3 }}>
              {totalPowerMW.toFixed(0)} MW
            </div>
            <div style={{ fontSize:9, color:"#4a5568", lineHeight:1.7 }}>
              ≈ {Math.ceil(totalPowerMW/75)} coal generators<br/>
              ≈ {Math.ceil(totalPowerMW/250)} fuel generators
            </div>
          </div>

          {/* Clear */}
          <button onClick={() => setResult(null)}
            style={{ width:"100%", marginTop:10, padding:"6px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:9, borderRadius:3, cursor:"pointer", fontFamily:"inherit", letterSpacing:1 }}>
            ✕ CLEAR RESULT
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Overclock mini-calc ──────────────────────────────────────────────────────

// ─── Main App ────────────────────────────────────────────────────────────────

export default function SatisfactoryPlanner() {
  const [placed,       setPlaced]       = useState([]);
  const [connections,  setConnections]  = useState([]);
  const [tool,         setTool]         = useState("select");
  const [selBuild,     setSelBuild]     = useState(null);   // sidebar building type to place
  const [beltMk,       setBeltMk]       = useState(1);
  const [hovered,      setHovered]      = useState(null);
  const [panel,        setPanel]        = useState("buildings");
  const [selPlaced,    setSelPlaced]    = useState(null);
  const [connecting,   setConnecting]   = useState(null);
  const [recipeQ,      setRecipeQ]      = useState("");
  const [recipeFilter, setRecipeFilter] = useState("all");
  const [gridW,        setGridW]        = useState(30);
  const [gridH,        setGridH]        = useState(20);
  const [showHelp,     setShowHelp]     = useState(false);
  const [selConn,      setSelConn]      = useState(null);
  const [importError,  setImportError]  = useState(null);
  const [zoom,         setZoom]         = useState(1);
  const [pan,          setPan]          = useState({ x: 20, y: 20 });
  const nextId    = useRef(1);
  const importRef = useRef(null);
  const viewportRef  = useRef(null);
  const isPanning    = useRef(false);
  const panStart     = useRef({ x: 0, y: 0 });
  const spaceDown    = useRef(false);
  const history      = useRef([]); // [{placed, connections}, ...]

  // Push current state onto history before a destructive action
  const pushHistory = useCallback(() => {
    history.current = [...history.current.slice(-49), { placed: placed, connections: connections }];
  }, [placed, connections]);

  const handleUndo = useCallback(() => {
    if (!history.current.length) return;
    const prev = history.current[history.current.length - 1];
    history.current = history.current.slice(0, -1);
    setPlaced(prev.placed);
    setConnections(prev.connections);
    setSelPlaced(null);
    setSelConn(null);
  }, []);

  // Space bar pan mode + Ctrl+Z undo
  useEffect(() => {
    const down = e => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); spaceDown.current = true; }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && e.target.tagName !== "INPUT") { e.preventDefault(); handleUndo(); }
    };
    const up = e => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup",   up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [handleUndo]);

  // Page title + favicon
  useEffect(() => {
    document.title = "PLANIT · Certified spaghetti-free.";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><clipPath id="pc"><circle cx="32" cy="32" r="23"/></clipPath><mask id="rf"><rect width="64" height="64" fill="white"/><rect x="0" y="32" width="64" height="32" fill="black"/></mask><mask id="rb"><rect x="0" y="32" width="64" height="32" fill="white"/></mask><radialGradient id="pg" cx="38%" cy="35%" r="65%"><stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#0a0e14"/></radialGradient></defs><ellipse cx="32" cy="32" rx="30" ry="7.5" fill="none" stroke="#f0a500" stroke-width="2.2" opacity="0.35" mask="url(#rb)"/><circle cx="32" cy="32" r="23" fill="url(#pg)"/><g clip-path="url(#pc)" fill="none" stroke="#f0a500" stroke-width="1.1" opacity="0.5"><ellipse cx="32" cy="32" rx="23" ry="7"/><ellipse cx="32" cy="32" rx="23" ry="14"/><ellipse cx="32" cy="32" rx="7" ry="23"/><ellipse cx="32" cy="32" rx="14" ry="23"/><line x1="9" y1="32" x2="55" y2="32" stroke-width="1.4" opacity="0.9"/><line x1="32" y1="9" x2="32" y2="55" stroke-width="1.4" opacity="0.9"/></g><circle cx="32" cy="32" r="23" fill="none" stroke="#f0a500" stroke-width="1.6"/><ellipse cx="32" cy="32" rx="30" ry="7.5" fill="none" stroke="#f0a500" stroke-width="2.2" opacity="0.9" mask="url(#rf)"/></svg>`;
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = url;
  }, []);

  const sel = placed.find(p => p.id === selPlaced);

  // Zoom to fit button
  const zoomFit = () => {
    if (!placed.length || !viewportRef.current) return;
    const vp = viewportRef.current;
    const vpW = vp.clientWidth, vpH = vp.clientHeight;
    const minX = Math.min(...placed.map(p=>p.x));
    const minY = Math.min(...placed.map(p=>p.y));
    const maxX = Math.max(...placed.map(p=>{ const d=BUILDINGS[p.type]; return p.x+d.w; }));
    const maxY = Math.max(...placed.map(p=>{ const d=BUILDINGS[p.type]; return p.y+d.h; }));
    const contentW = (maxX - minX) * CELL;
    const contentH = (maxY - minY) * CELL;
    const pad = CELL * 2;
    const newZoom = Math.min(3, Math.max(0.2, Math.min((vpW - pad*2) / contentW, (vpH - pad*2) / contentH)));
    setZoom(newZoom);
    setPan({ x: (vpW - contentW * newZoom) / 2 - minX * CELL * newZoom, y: (vpH - contentH * newZoom) / 2 - minY * CELL * newZoom });
  };

  // ── Export ──
  const handleExport = () => {
    const data = {
      version: 1,
      gridW, gridH,
      placed,
      connections,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "planit-layout.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import ──
  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.placed || !data.connections) throw new Error("Invalid layout file");
        setPlaced(data.placed);
        setConnections(data.connections);
        if (data.gridW) setGridW(data.gridW);
        if (data.gridH) setGridH(data.gridH);
        // Reset next id to avoid collisions
        const maxId = Math.max(0, ...data.placed.map(p=>p.id), ...data.connections.map(c=>c.id));
        nextId.current = maxId + 1;
        setSelPlaced(null);
        setSelConn(null);
      } catch {
        setImportError("Invalid file — couldn't load layout.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── New ──
  const handleNew = () => {
    if (placed.length > 0 && !window.confirm("Start a new layout? Current layout will be lost.")) return;
    pushHistory();
    setPlaced([]);
    setConnections([]);
    setSelPlaced(null);
    setSelConn(null);
    nextId.current = 1;
  };

  const handleDuplicate = () => {
    if (!sel) return;
    const def = BUILDINGS[sel.type];
    const offsets = [
      { dx: def.w + 1, dy: 0 },
      { dx: 0,         dy: def.h + 1 },
      { dx: def.w + 1, dy: def.h + 1 },
      { dx: def.w * 2 + 2, dy: 0 },
      { dx: 0, dy: def.h * 2 + 2 },
    ];
    for (const { dx, dy } of offsets) {
      const nx = sel.x + dx, ny = sel.y + dy;
      const fits = nx + def.w <= gridW && ny + def.h <= gridH;
      const clear = !placed.some(p => {
        const pd = BUILDINGS[p.type];
        return !(nx >= p.x+pd.w || nx+def.w <= p.x || ny >= p.y+pd.h || ny+def.h <= p.y);
      });
      if (fits && clear) {
        pushHistory();
        const newId = nextId.current++;
        setPlaced(prev => [...prev, { ...sel, id: newId, x: nx, y: ny }]);
        setSelPlaced(newId);
        return;
      }
    }
    pushHistory();
    const newId = nextId.current++;
    setPlaced(prev => [...prev, { ...sel, id: newId, x: sel.x + def.w + 1, y: sel.y }]);
    setSelPlaced(newId);
  };

  const clickCell = useCallback((cx, cy) => {
    if (tool === "place" && selBuild) {
      const def = BUILDINGS[selBuild];
      const bad = placed.some(p => {
        const pd = BUILDINGS[p.type];
        return !(cx >= p.x+pd.w || cx+def.w <= p.x || cy >= p.y+pd.h || cy+def.h <= p.y);
      });
      if (bad) return;
      pushHistory();
      setPlaced(prev => [...prev, { id:nextId.current++, type:selBuild, x:cx, y:cy, label:def.label, clock:100, note:"" }]);
    } else if (tool === "select") {
      const hit = placed.find(p => { const d=BUILDINGS[p.type]; return cx>=p.x&&cx<p.x+d.w&&cy>=p.y&&cy<p.y+d.h; });
      setSelPlaced(hit ? hit.id : null);
    }
  }, [tool, selBuild, placed]);

  const delSel = () => {
    if (!selPlaced) return;
    pushHistory();
    setPlaced(p => p.filter(x => x.id !== selPlaced));
    setConnections(c => c.filter(x => x.from !== selPlaced && x.to !== selPlaced));
    setSelPlaced(null);
  };

  const doConnect = (id) => {
    if (!connecting) { setConnecting(id); return; }
    if (connecting !== id) {
      const fp = placed.find(p=>p.id===connecting), tp = placed.find(p=>p.id===id);
      if (fp && tp && BUILDINGS[fp.type].outputs>0 && BUILDINGS[tp.type].inputs>0) {
        pushHistory();
        setConnections(prev => [...prev, { id:nextId.current++, from:connecting, to:id, belt:beltMk }]);
      }
    }
    setConnecting(null);
  };

  const netPower = placed.reduce((s,p) => {
    const d = BUILDINGS[p.type]; if (!d.power) return s;
    return s + (d.power>0 ? calcPower(d.power,p.clock) : d.power);
  }, 0);

  const filtRecipes = Object.entries(RECIPES).filter(([,r]) => {
    const matchQ = r.out.toLowerCase().includes(recipeQ.toLowerCase()) || (r.altName||"").toLowerCase().includes(recipeQ.toLowerCase());
    const matchF = recipeFilter==="all" || (recipeFilter==="alt"?r.alt:!r.alt);
    return matchQ && matchF;
  });

  const overcapCount = connections.filter(c => {
    const fp = placed.find(p=>p.id===c.from);
    if (!fp) return false;
    const rate = getBuildingOutputRate(fp);
    if (rate == null) return false;
    return rate > BELT_MARKS[c.belt-1].speed;
  }).length;

  const PANELS = ["buildings","belts","recipes","ratio","list"];

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"'Share Tech Mono','Courier New',monospace", background:"#0a0e14", color:"#c9d1d9", overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;700&display=swap');
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#0d1117}::-webkit-scrollbar-thumb{background:#2a3040;border-radius:3px}
        .bb{transition:all .14s;border:1px solid #2a3040;cursor:pointer}.bb:hover{border-color:#f0a500!important;filter:brightness(1.2)}.bb.on{border-color:#f0a500!important;box-shadow:0 0 7px #f0a50055}
        .tb{transition:all .11s;cursor:pointer}.tb:hover{background:#1e2530!important}.tb.on{background:#1e3a20!important;border-color:#4ade80!important;color:#4ade80!important}
        .pt{cursor:pointer;transition:color .11s;user-select:none}.pt:hover{color:#f0a500}.pt.on{color:#f0a500;border-bottom:2px solid #f0a500}
        .bo:hover{background:#1e2530!important}.bo.on{background:#1e2530!important;outline:1px solid #f0a500}
        .pi{cursor:pointer;transition:filter .1s}.pi:hover{filter:brightness(1.15)}.pi.on{outline:2px solid #f0a500;outline-offset:1px}
        input[type=range]{accent-color:#f0a500}
        input[type=text],input[type=number]{background:#0d1117;border:1px solid #2a3040;color:#c9d1d9;padding:4px 8px;border-radius:3px;font-family:inherit;font-size:12px}
        input:focus{outline:1px solid #f0a500}
        select:focus{outline:1px solid #f0a500}
      `}</style>

      {/* LEFT SIDEBAR */}
      <div style={{ width:270, background:"#0d1117", borderRight:"1px solid #1c2333", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"13px 15px 8px", borderBottom:"1px solid #1c2333" }}>
          <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:22, fontWeight:700, letterSpacing:2 }}><span style={{ color:"#f0a500" }}>PLAN</span><span style={{ color:"#c9d1d9" }}>IT</span></div>
          <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:2 }}>Certified spaghetti-free. Results may vary.</div>
          <div style={{ fontSize:9, color:"#2a3040", marginBottom:8 }}>Unofficial fan tool · Not affiliated with Coffee Stain Studios</div>
          <div style={{ display:"flex", gap:5 }}>
            <button className="tb" onClick={handleNew}
              style={{ flex:1, padding:"4px 0", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:10, borderRadius:3, letterSpacing:0.5 }}>
              ✦ NEW
            </button>
            <button className="tb" onClick={handleExport} disabled={placed.length===0}
              style={{ flex:1, padding:"4px 0", background:"#0a0e14", border:"1px solid #2a3040", color:placed.length>0?"#4ade80":"#2a3040", fontSize:10, borderRadius:3, letterSpacing:0.5, cursor:placed.length>0?"pointer":"default" }}>
              ↓ SAVE
            </button>
            <button className="tb" onClick={()=>importRef.current?.click()}
              style={{ flex:1, padding:"4px 0", background:"#0a0e14", border:"1px solid #2a3040", color:"#60a5fa", fontSize:10, borderRadius:3, letterSpacing:0.5 }}>
              ↑ LOAD
            </button>
            <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{ display:"none" }} />
          </div>
          {importError && <div style={{ fontSize:10, color:"#f87171", marginTop:4 }}>{importError}</div>}
        </div>

        {/* Tools */}
        <div style={{ padding:"8px 11px", borderBottom:"1px solid #1c2333" }}>
          <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:5 }}>TOOLS</div>
          <div style={{ display:"flex", gap:5 }}>
            {[["select","↖","SEL"],["place","+","PLACE"],["connect","⟶","WIRE"],["delete","✕","DEL"]].map(([id,ic,lb])=>(
              <button key={id} className={`tb${tool===id?" on":""}`}
                onClick={()=>{ setTool(id); if(id!=="place") setSelBuild(null); }}
                style={{ flex:1, padding:"4px 2px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:7, borderRadius:3 }}>
                <div style={{ fontSize:13 }}>{ic}</div><div style={{ fontSize:9, marginTop:1 }}>{lb}</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop:4, fontSize:11, minHeight:15 }}>
            {tool==="place"&&<span style={{ color:"#4ade80" }}>{selBuild?`→ ${BUILDINGS[selBuild]?.label}`:"Pick a building"}</span>}
            {tool==="connect"&&<span style={{ color:"#60a5fa" }}>{connecting?"Click target":"Click source building"}</span>}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid #1c2333" }}>
          {PANELS.map(t=>(
            <div key={t} className={`pt${panel===t?" on":""}`}
              onClick={()=>setPanel(t)}
              style={{ flex:1, textAlign:"center", padding:"6px 0", fontSize:10, letterSpacing:0.7, color:"#8b949e" }}>
              {t.toUpperCase()}
            </div>
          ))}
        </div>

        {/* Panel content */}
        <div style={{ flex:1, overflowY:"auto", padding: panel==="ratio"?0:"7px 9px" }}>
          {panel==="buildings"&&CATEGORIES.map(cat=>(
            <div key={cat} style={{ marginBottom:9 }}>
              <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:4, paddingBottom:2, borderBottom:"1px solid #1c2333" }}>{CAT_LABELS[cat].toUpperCase()}</div>
              {Object.entries(BUILDINGS).filter(([,d])=>d.cat===cat).map(([id,d])=>(
                <button key={id} className={`bb${selBuild===id?" on":""}`}
                  onClick={()=>{ setSelBuild(id); setTool("place"); }}
                  style={{ display:"flex", alignItems:"center", gap:6, width:"100%", background:"#0a0e14", padding:"4px 6px", marginBottom:2, borderRadius:3, textAlign:"left" }}>
                  <span style={{ fontSize:13 }}>{d.icon}</span>
                  <div><div style={{ fontSize:12, color:"#c9d1d9" }}>{d.label}</div><div style={{ fontSize:10, color:"#4a5568" }}>{d.w}×{d.h} found.</div></div>
                </button>
              ))}
            </div>
          ))}

          {panel==="belts"&&(
            <div>
              <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:7 }}>SELECT BELT MARK</div>
              {BELT_MARKS.map(b=>(
                <div key={b.mk} className={`bo${beltMk===b.mk?" on":""}`}
                  onClick={()=>{ setBeltMk(b.mk); setTool("connect"); }}
                  style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", marginBottom:3, borderRadius:3, background:"#0a0e14", cursor:"pointer", border:"1px solid #1c2333" }}>
                  <div style={{ width:3, height:24, background:b.color, borderRadius:2, flexShrink:0 }} />
                  <div><div style={{ fontSize:12, color:"#c9d1d9", fontWeight:600 }}>Mk.{b.mk}</div><div style={{ fontSize:11, color:b.color }}>{b.speed}/min</div></div>
                </div>
              ))}
            </div>
          )}

          {panel==="recipes"&&(
            <div>
              <input type="text" placeholder="Search…" value={recipeQ} onChange={e=>setRecipeQ(e.target.value)} style={{ width:"100%", marginBottom:5, boxSizing:"border-box" }} />
              <div style={{ display:"flex", gap:5, marginBottom:7 }}>
                {[["all","All"],["standard","Standard"],["alt","Alts"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setRecipeFilter(v)}
                    style={{ flex:1, padding:"3px 0", background: recipeFilter===v?"#1e2530":"#0a0e14", border:`1px solid ${recipeFilter===v?"#f0a500":"#2a3040"}`, color:recipeFilter===v?"#f0a500":"#4a5568", fontSize:10, borderRadius:3, cursor:"pointer", fontFamily:"inherit" }}>
                    {l}
                  </button>
                ))}
              </div>
              {filtRecipes.map(([id,r])=>(
                <div key={id} style={{ padding:"5px 7px", marginBottom:3, background:"#0a0e14", border:`1px solid ${r.alt?"#4c1d95":"#1c2333"}`, borderRadius:3, fontSize:11 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:1 }}>
                    {r.alt&&<span style={{ fontSize:9, color:"#a78bfa", border:"1px solid #7c3aed", borderRadius:2, padding:"0 3px" }}>ALT</span>}
                    <span style={{ color: r.alt?"#a78bfa":"#f0a500" }}>{r.alt ? r.altName : r.out}</span>
                  </div>
                  <div style={{ color:"#8b949e", marginBottom:1 }}>→ {r.out} {r.rate}/min · {BUILDINGS[r.bld]?.label}</div>
                  <div style={{ color:"#4a5568" }}>{r.ins.map((x,n)=><span key={n}>{x.i} {x.rate}/min{n<r.ins.length-1?" + ":""}</span>)}</div>
                </div>
              ))}
            </div>
          )}

          {panel==="ratio"&&<RatioCalculator />}

          {panel==="list"&&(()=>{
            if (!placed.length) return (
              <div style={{ padding:"22px 13px", textAlign:"center" }}>
                <div style={{ fontSize:24, opacity:.2, marginBottom:7 }}>📋</div>
                <div style={{ fontSize:10, color:"#4a5568", lineHeight:1.8 }}>Place buildings to see your list</div>
              </div>
            );

            // Count by type
            const counts = {};
            for (const p of placed) {
              if (!counts[p.type]) counts[p.type] = { count:0, power:0, recipes:{} };
              counts[p.type].count++;
              const d = BUILDINGS[p.type];
              if (d.power > 0) counts[p.type].power += calcPower(d.power, p.clock);
              if (p.recipe) counts[p.type].recipes[p.recipe] = (counts[p.type].recipes[p.recipe]||0)+1;
            }

            const totalBuildings = placed.length;
            const totalPower = Math.round(netPower);

            return (
              <div style={{ padding:"7px 9px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9, paddingBottom:7, borderBottom:"1px solid #1c2333" }}>
                  <span style={{ fontSize:11, fontFamily:"'Rajdhani'", fontWeight:700, color:"#c9d1d9" }}>BUILD LIST</span>
                  <span style={{ fontSize:9, color:"#4a5568" }}>{totalBuildings} total</span>
                </div>

                {CATEGORIES.filter(cat => Object.entries(counts).some(([id])=>BUILDINGS[id]?.cat===cat)).map(cat=>(
                  <div key={cat} style={{ marginBottom:11 }}>
                    <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:5, paddingBottom:2, borderBottom:"1px solid #1c2333" }}>
                      {CAT_LABELS[cat].toUpperCase()}
                    </div>
                    {Object.entries(counts)
                      .filter(([id])=>BUILDINGS[id]?.cat===cat)
                      .sort((a,b)=>b[1].count-a[1].count)
                      .map(([id,{count,recipes}])=>{
                        const d = BUILDINGS[id];
                        const recipeEntries = Object.entries(recipes);
                        return (
                          <div key={id} style={{ marginBottom:5 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 7px", background:"#0a0e14", border:"1px solid #1c2333", borderRadius:3 }}>
                              <div style={{ width:3, alignSelf:"stretch", background:d.color, borderRadius:2, flexShrink:0 }} />
                              <span style={{ fontSize:12 }}>{d.icon}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:12, color:"#c9d1d9", marginBottom:1 }}>{d.label}</div>
                                {recipeEntries.length > 0 && (
                                  <div style={{ fontSize:10, color:"#4a5568" }}>
                                    {recipeEntries.map(([rk,rc])=>{
                                      const r = RECIPES[rk];
                                      return <span key={rk}>{rc}× {r?.altName||r?.out}</span>;
                                    }).reduce((a,b)=>[a,', ',b])}
                                  </div>
                                )}
                              </div>
                              <div style={{ background:d.color+"22", border:`1px solid ${d.color}55`, borderRadius:3, padding:"2px 7px", fontSize:12, fontFamily:"'Rajdhani'", fontWeight:700, color:d.color, minWidth:28, textAlign:"center" }}>
                                {count}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    }
                  </div>
                ))}

                <div style={{ marginTop:4, padding:"8px 9px", background:"#0a0e14", border:"1px solid #1c2333", borderRadius:3 }}>
                  <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:6 }}>POWER SUMMARY</div>
                  {[
                    ["Consumption", `${Math.round(placed.reduce((s,p)=>{ const d=BUILDINGS[p.type]; return d.power>0?s+calcPower(d.power,p.clock):s; },0))} MW`, "#f87171"],
                    ["Generation",  `${Math.abs(Math.round(placed.reduce((s,p)=>{ const d=BUILDINGS[p.type]; return d.power<0?s+d.power:s; },0)))} MW`, "#4ade80"],
                    ["Net",         `${totalPower>0?"+":""}${totalPower} MW`, totalPower>0?"#f87171":"#4ade80"],
                  ].map(([k,v,c])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ fontSize:9, color:"#4a5568" }}>{k}</span>
                      <span style={{ fontSize:9, color:c, fontFamily:"'Rajdhani'", fontWeight:700 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Footer stats */}
        <div style={{ padding:"8px 11px", borderTop:"1px solid #1c2333", fontSize:9 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7 }}>
            <span style={{ color:"#4a5568", letterSpacing:1, fontSize:8 }}>GRID</span>
            <span style={{ color:"#4a5568" }}>W</span>
            <input type="number" value={gridW} min={10} max={80} onChange={e=>setGridW(+e.target.value)} style={{ width:38, fontSize:10, padding:"2px 5px" }} />
            <span style={{ color:"#4a5568" }}>H</span>
            <input type="number" value={gridH} min={10} max={60} onChange={e=>setGridH(+e.target.value)} style={{ width:38, fontSize:10, padding:"2px 5px" }} />
          </div>
          {[["Buildings",placed.length,"#c9d1d9"],["Belts",connections.length,"#c9d1d9"],["Net Power",`${netPower>0?"+":""}${Math.round(netPower)} MW`,netPower>0?"#f87171":"#4ade80"]].map(([k,v,c])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
              <span style={{ color:"#4a5568" }}>{k}</span><span style={{ color:c }}>{v}</span>
            </div>
          ))}
          {overcapCount > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, padding:"4px 6px", background:"#1a0808", border:"1px solid #7f1d1d", borderRadius:3 }}>
              <span style={{ color:"#f87171" }}>⚠ Overcap belts</span>
              <span style={{ color:"#f87171", fontWeight:600 }}>{overcapCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* MAIN GRID */}
      <div
        style={{ flex:1, overflow:"hidden", background:"#0a0e14", position:"relative" }}
        onWheel={e=>{
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse)
            // Zoom centered on cursor position
            const vp = viewportRef.current;
            if (!vp) return;
            const rect = vp.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.08 : 0.93;
            setZoom(z => {
              const next = Math.min(3, Math.max(0.2, z * factor));
              // Adjust pan so the point under cursor stays fixed
              setPan(p => ({
                x: mx - (mx - p.x) * (next / z),
                y: my - (my - p.y) * (next / z),
              }));
              return next;
            });
          } else {
            // Two-finger scroll (trackpad) or plain scroll (mouse) = pan
            setPan(p => ({
              x: p.x - e.deltaX,
              y: p.y - e.deltaY,
            }));
          }
        }}
        onMouseDown={e=>{
          // Middle mouse or Space+left drag to pan
          if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
            e.preventDefault();
            isPanning.current = true;
            panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          }
        }}
        onMouseMove={e=>{
          if (isPanning.current) {
            setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
          }
        }}
        onMouseUp={()=>{ isPanning.current = false; }}
        onMouseLeave={()=>{ isPanning.current = false; }}
        ref={viewportRef}
      >
        <div style={{ position:"sticky", top:0, zIndex:10, background:"#0d1117", borderBottom:"1px solid #1c2333", padding:"5px 13px", display:"flex", alignItems:"center", gap:9 }}>
          <button className="tb" onClick={handleUndo} disabled={history.current.length===0}
            style={{ padding:"3px 9px", background:"#0a0e14", border:`1px solid ${history.current.length>0?"#2a3040":"#1c2333"}`, color:history.current.length>0?"#c9d1d9":"#2a3040", fontSize:9, borderRadius:3 }}>
            ↩ UNDO
          </button>
          <div style={{ flex:1 }} />
          <button className="tb" onClick={()=>setZoom(z=>Math.min(3,+(z*1.25).toFixed(2)))} style={{ padding:"3px 7px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:11, borderRadius:3 }}>+</button>
          <span style={{ fontSize:9, color:"#8b949e", minWidth:32, textAlign:"center" }}>{Math.round(zoom*100)}%</span>
          <button className="tb" onClick={()=>setZoom(z=>Math.max(0.2,+(z*0.8).toFixed(2)))} style={{ padding:"3px 7px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:11, borderRadius:3 }}>−</button>
          <button className="tb" onClick={zoomFit} style={{ padding:"3px 7px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:9, borderRadius:3 }}>FIT</button>
          <button className="tb" onClick={()=>{ setZoom(1); setPan({x:20,y:20}); }} style={{ padding:"3px 7px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:9, borderRadius:3 }}>1:1</button>
          <div style={{ width:1, height:16, background:"#1c2333" }} />
          <button onClick={()=>setShowHelp(h=>!h)} style={{ padding:"3px 7px", background:"#0a0e14", border:"1px solid #2a3040", color:"#8b949e", fontSize:9, borderRadius:3, cursor:"pointer" }}>?</button>
        </div>

        <div style={{
          position:"absolute", top:0, left:0,
          transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          transformOrigin:"0 0",
          width:gridW*CELL, height:gridH*CELL,
          cursor: isPanning.current ? "grabbing" : spaceDown.current ? "grab" : undefined,
        }}>
          <svg style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:2 }} width={gridW*CELL} height={gridH*CELL}>
            {Array.from({length:gridW+1}).map((_,i)=>(
              <line key={`v${i}`} x1={i*CELL} y1={0} x2={i*CELL} y2={gridH*CELL} stroke={i%5===0?"#1e2a3a":"#131b26"} strokeWidth={i%5===0?1.5:.75}/>
            ))}
            {Array.from({length:gridH+1}).map((_,i)=>(
              <line key={`h${i}`} x1={0} y1={i*CELL} x2={gridW*CELL} y2={i*CELL} stroke={i%5===0?"#1e2a3a":"#131b26"} strokeWidth={i%5===0?1.5:.75}/>
            ))}
            {connections.map(c=>{
              const fp=placed.find(p=>p.id===c.from), tp=placed.find(p=>p.id===c.to);
              if(!fp||!tp) return null;
              const blt=BELT_MARKS[c.belt-1];
              const outputRate = getBuildingOutputRate(fp);
              return <BeltRoute key={c.id}
                conn={c} fromP={fp} toP={tp} placed={placed}
                beltColor={blt.color} beltMk={c.belt} beltSpeed={blt.speed}
                outputRate={outputRate}
                isSelected={selConn===c.id}
                onClick={e=>{ e.stopPropagation(); setSelConn(selConn===c.id?null:c.id); setSelPlaced(null); }}
              />;
            })}
          </svg>

          {tool==="place"&&selBuild&&hovered&&(()=>{
            const d=BUILDINGS[selBuild];
            return <div style={{ position:"absolute", left:hovered.x*CELL, top:hovered.y*CELL, width:d.w*CELL, height:d.h*CELL, background:d.color+"33", border:`2px dashed ${d.color}`, borderRadius:3, pointerEvents:"none", zIndex:2, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:Math.min(d.w,d.h)*12, opacity:.6 }}>{d.icon}</span>
            </div>;
          })()}

          {Array.from({length:gridH}).map((_,cy)=>Array.from({length:gridW}).map((_,cx)=>(
            <div key={`${cx}-${cy}`} style={{ position:"absolute", left:cx*CELL, top:cy*CELL, width:CELL, height:CELL, zIndex:3, cursor:tool==="place"?"crosshair":"default" }}
              onMouseEnter={()=>setHovered({x:cx,y:cy})} onMouseLeave={()=>setHovered(null)} onClick={()=>clickCell(cx,cy)} />
          )))}

          {placed.map(p=>{
            const d=BUILDINGS[p.type]; const isSel=p.id===selPlaced; const isCon=p.id===connecting;
            return <div key={p.id} className={`pi${isSel?" on":""}`}
              style={{ position:"absolute", left:p.x*CELL+1, top:p.y*CELL+1, width:d.w*CELL-2, height:d.h*CELL-2, background:d.color+"22", border:`2px solid ${isCon?"#60a5fa":isSel?"#f0a500":d.color+"99"}`, borderRadius:4, zIndex:4, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", boxShadow:isSel?`0 0 10px ${d.color}55`:"none" }}
              onClick={()=>{
                if(tool==="connect") doConnect(p.id);
                else if(tool==="delete"){ pushHistory(); setPlaced(prev=>prev.filter(x=>x.id!==p.id)); setConnections(prev=>prev.filter(c=>c.from!==p.id&&c.to!==p.id)); }
                else setSelPlaced(isSel?null:p.id);
              }}>
              <div style={{ fontSize:Math.min(d.w,d.h)*10+6 }}>{d.icon}</div>
              {d.h>=2&&<div style={{ fontSize:8, color:d.color, textAlign:"center", padding:"0 3px", lineHeight:1.2, marginTop:1 }}>{p.label}</div>}
              {MINER_TYPES.has(p.type) && p.nodeResource && (
                <div style={{ fontSize:7, color:"#c9d1d9", textAlign:"center", padding:"0 3px", lineHeight:1.4, opacity:0.9 }}>{p.nodeResource}</div>
              )}
              {MINER_TYPES.has(p.type) && (
                <div style={{ fontSize:7, textAlign:"center", color: PURITY.find(x=>x.id===(p.nodePurity||"normal"))?.color }}>
                  {PURITY.find(x=>x.id===(p.nodePurity||"normal"))?.label}
                </div>
              )}
              {p.recipe&&<div style={{ fontSize:7, color:"#c9d1d9", textAlign:"center", padding:"0 3px", lineHeight:1.2, opacity:0.8 }}>{RECIPES[p.recipe]?.out}</div>}
              {p.clock!==100&&<div style={{ fontSize:8, color:"#f0a500" }}>{p.clock}%</div>}
            </div>;
          })}

          {Array.from({length:Math.ceil(gridW/5)}).map((_,i)=>(
            <div key={`xl${i}`} style={{ position:"absolute", left:i*5*CELL+2, top:2, fontSize:7, color:"#1e2a3a", pointerEvents:"none" }}>{i*5}</div>
          ))}
          {Array.from({length:Math.ceil(gridH/5)}).map((_,i)=>(
            <div key={`yl${i}`} style={{ position:"absolute", left:2, top:i*5*CELL+2, fontSize:7, color:"#1e2a3a", pointerEvents:"none" }}>{i*5}</div>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={{ width:250, background:"#0d1117", borderLeft:"1px solid #1c2333", display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto" }}>
        <div style={{ padding:"10px 13px", borderBottom:"1px solid #1c2333", fontFamily:"'Rajdhani',sans-serif", fontSize:13, fontWeight:700, color:"#c9d1d9", letterSpacing:1 }}>PROPERTIES</div>

        {sel?(()=>{
          const d=BUILDINGS[sel.type];
          const pw=d.power?calcPower(Math.abs(d.power),sel.clock):0;
          // Recipes valid for this building type
          const compatRecipes = Object.entries(RECIPES).filter(([,r])=>r.bld===sel.type);
          const selRecipe = sel.recipe ? RECIPES[sel.recipe] : null;
          const clockMult = sel.clock / 100;

          return <div style={{ padding:"11px 13px" }}>
            <div style={{ fontSize:15, marginBottom:4 }}>{d.icon} <span style={{ fontFamily:"'Rajdhani'", fontWeight:700, color:d.color, fontSize:13 }}>{sel.label}</span></div>
            <div style={{ fontSize:9, color:"#4a5568", marginBottom:9 }}>{d.w}×{d.h} foundations · {d.w*8}m × {d.h*8}m</div>

            {/* Miner node selector */}
            {MINER_TYPES.has(sel.type) && (
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:5 }}>NODE RESOURCE</div>
                <select
                  value={sel.nodeResource||""}
                  onChange={e=>setPlaced(prev=>prev.map(p=>p.id===selPlaced?{...p,nodeResource:e.target.value||null}:p))}
                  style={{ width:"100%", boxSizing:"border-box", background:"#0d1117", border:"1px solid #2a3040", color:sel.nodeResource?"#c9d1d9":"#4a5568", padding:"5px 7px", borderRadius:3, fontFamily:"inherit", fontSize:11, cursor:"pointer", marginBottom:6 }}>
                  <option value="">— select resource —</option>
                  {MINER_RESOURCES.map(r=>(
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>

                <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:5 }}>NODE PURITY</div>
                <div style={{ display:"flex", gap:5 }}>
                  {PURITY.map(p=>(
                    <button key={p.id}
                      onClick={()=>setPlaced(prev=>prev.map(x=>x.id===selPlaced?{...x,nodePurity:p.id}:x))}
                      style={{ flex:1, padding:"5px 0", background: (sel.nodePurity||"normal")===p.id ? p.color+"22" : "#0a0e14", border:`1px solid ${(sel.nodePurity||"normal")===p.id ? p.color : "#2a3040"}`, color:(sel.nodePurity||"normal")===p.id ? p.color : "#4a5568", fontSize:9, borderRadius:3, cursor:"pointer", fontFamily:"inherit" }}>
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Output rate card */}
                {sel.nodeResource && (
                  <div style={{ marginTop:7, padding:"8px 9px", background:"#0a0e14", border:"1px solid #1c2333", borderRadius:3 }}>
                    <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:5 }}>OUTPUT</div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                      <span style={{ fontSize:11, color:"#4ade80" }}>{sel.nodeResource}</span>
                      <span style={{ fontSize:12, color:"#4ade80", fontFamily:"'Rajdhani',sans-serif", fontWeight:700 }}>
                        {minerOutputRateFull(sel.type, sel.nodePurity||"normal", sel.clock).toFixed(2)}
                        <span style={{ fontSize:10, color:"#4a5568", marginLeft:2 }}>/min</span>
                      </span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:9 }}>
                      <span style={{ color:"#4a5568" }}>Base rate</span>
                      <span style={{ color:"#8b949e" }}>{BUILDINGS[sel.type].baseOutput}/min</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:9 }}>
                      <span style={{ color:"#4a5568" }}>Purity mult</span>
                      <span style={{ color: PURITY.find(p=>p.id===(sel.nodePurity||"normal"))?.color }}>
                        ×{PURITY.find(p=>p.id===(sel.nodePurity||"normal"))?.mult}
                      </span>
                    </div>
                    {/* Belt recommendation */}
                    {(()=>{
                      const rate = minerOutputRateFull(sel.type, sel.nodePurity||"normal", sel.clock);
                      const belt = BELT_MARKS.find(b=>b.speed>=rate) || BELT_MARKS[5];
                      return (
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginTop:2 }}>
                          <span style={{ color:"#4a5568" }}>Min belt</span>
                          <span style={{ color:belt.color }}>Mk.{belt.mk} ({belt.speed}/min)</span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Recipe selector */}
            {compatRecipes.length > 0 && (
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:5 }}>RECIPE</div>
                <select
                  value={sel.recipe||""}
                  onChange={e=>setPlaced(prev=>prev.map(p=>p.id===selPlaced?{...p,recipe:e.target.value||null}:p))}
                  style={{ width:"100%", boxSizing:"border-box", background:"#0d1117", border:"1px solid #2a3040", color: sel.recipe?"#c9d1d9":"#4a5568", padding:"5px 7px", borderRadius:3, fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>
                  <option value="">— none —</option>
                  <optgroup label="Standard">
                    {compatRecipes.filter(([,r])=>!r.alt).map(([key,r])=>(
                      <option key={key} value={key}>{r.out}</option>
                    ))}
                  </optgroup>
                  {compatRecipes.some(([,r])=>r.alt) && (
                    <optgroup label="── Alternate ──">
                      {compatRecipes.filter(([,r])=>r.alt).map(([key,r])=>(
                        <option key={key} value={key}>★ {r.altName}</option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {/* Live rate card */}
                {selRecipe && (
                  <div style={{ marginTop:7, padding:"8px 9px", background:"#0a0e14", border:`1px solid ${selRecipe.alt?"#7c3aed33":"#1c2333"}`, borderRadius:3 }}>
                    {selRecipe.alt && (
                      <div style={{ fontSize:8, color:"#a78bfa", letterSpacing:1, marginBottom:5 }}>★ ALT: {selRecipe.altName}</div>
                    )}
                    {/* Output */}
                    <div style={{ marginBottom:6 }}>
                      <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:4 }}>OUTPUT</div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:11, color:"#4ade80" }}>{selRecipe.out}</span>
                        <span style={{ fontSize:12, color:"#4ade80", fontFamily:"'Rajdhani',sans-serif", fontWeight:700 }}>
                          {(selRecipe.rate * clockMult).toFixed(2)}<span style={{ fontSize:10, color:"#4a5568", marginLeft:2 }}>/min</span>
                        </span>
                      </div>
                      {sel.clock!==100&&<div style={{ fontSize:10, color:"#4a5568", marginTop:1 }}>Base: {selRecipe.rate}/min</div>}
                    </div>
                    {/* Inputs */}
                    <div style={{ borderTop:"1px solid #1c2333", paddingTop:6 }}>
                      <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:4 }}>INPUTS</div>
                      {selRecipe.ins.map((inp,i)=>(
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                          <span style={{ fontSize:10, color:"#8b949e" }}>{inp.i}</span>
                          <span style={{ fontSize:11, color:"#f87171", fontFamily:"'Rajdhani',sans-serif", fontWeight:700 }}>
                            {(inp.rate * clockMult).toFixed(2)}<span style={{ fontSize:10, color:"#4a5568", marginLeft:2 }}>/min</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Clock speed */}
            <div style={{ marginBottom:9 }}>
              <div style={{ fontSize:9, color:"#4a5568", letterSpacing:1, marginBottom:4 }}>CLOCK SPEED</div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                <input type="range" min={1} max={250} value={sel.clock}
                  onChange={e=>setPlaced(prev=>prev.map(p=>p.id===selPlaced?{...p,clock:+e.target.value}:p))}
                  style={{ flex:1 }} />
                <input type="number" min={1} max={250} value={sel.clock}
                  onChange={e=>setPlaced(prev=>prev.map(p=>p.id===selPlaced?{...p,clock:Math.min(250,Math.max(1,+e.target.value))}:p))}
                  style={{ width:42 }} />
                <span style={{ fontSize:9, color:"#8b949e" }}>%</span>
              </div>
              {sel.clock>100&&<div style={{ fontSize:9, color:"#f0a500" }}>Shards: {sel.clock<=150?1:sel.clock<=200?2:3}</div>}
            </div>

            {d.power&&<div style={{ marginBottom:9, padding:"7px", background:"#0a0e14", borderRadius:3, border:"1px solid #1c2333" }}>
              <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:2 }}>POWER</div>
              <div style={{ fontSize:13, color:d.power<0?"#4ade80":"#f87171" }}>{d.power<0?"+":""}{pw.toFixed(1)} MW</div>
              {sel.clock!==100&&<div style={{ fontSize:9, color:"#4a5568" }}>Base: {Math.abs(d.power)} MW</div>}
            </div>}

            <div style={{ marginBottom:9 }}>
              <div style={{ fontSize:10, color:"#4a5568", letterSpacing:1, marginBottom:3 }}>NOTE</div>
              <input type="text" placeholder="Add note…" value={sel.note||""}
                onChange={e=>setPlaced(prev=>prev.map(p=>p.id===selPlaced?{...p,note:e.target.value}:p))}
                style={{ width:"100%", boxSizing:"border-box" }} />
            </div>

            <div style={{ fontSize:9, color:"#4a5568", marginBottom:8 }}>Col {sel.x}, Row {sel.y} · {sel.x*8}m, {sel.y*8}m</div>
            <div style={{ display:"flex", gap:6, marginBottom:0 }}>
              <button onClick={handleDuplicate}
                style={{ flex:1, padding:"6px", background:"#0a1020", border:"1px solid #1d4ed8", color:"#60a5fa", fontSize:9, borderRadius:3, cursor:"pointer", letterSpacing:1 }}>
                ⧉ DUPLICATE
              </button>
              <button onClick={delSel}
                style={{ flex:1, padding:"6px", background:"#1a0a0a", border:"1px solid #b91c1c", color:"#f87171", fontSize:9, borderRadius:3, cursor:"pointer", letterSpacing:1 }}>
                ✕ DELETE
              </button>
            </div>
          </div>;
        })():selConn?(()=>{
          const conn = connections.find(c=>c.id===selConn);
          if (!conn) return null;
          const blt = BELT_MARKS[conn.belt-1];
          const fp = placed.find(p=>p.id===conn.from);
          const tp = placed.find(p=>p.id===conn.to);
          const rate = fp ? getBuildingOutputRate(fp) : null;
          const overcap = rate != null && rate > blt.speed;
          return (
            <div style={{ padding:"11px 13px" }}>
              <div style={{ fontSize:13, fontFamily:"'Rajdhani'", fontWeight:700, color:blt.color, marginBottom:4 }}>
                Belt Mk.{conn.belt}
              </div>
              <div style={{ fontSize:9, color:"#4a5568", marginBottom:9 }}>{blt.speed}/min capacity</div>
              {fp&&<div style={{ fontSize:9, color:"#8b949e", marginBottom:2 }}>From: {fp.label}</div>}
              {tp&&<div style={{ fontSize:9, color:"#8b949e", marginBottom:9 }}>To: {tp.label}</div>}
              {overcap&&(
                <div style={{ padding:"7px 9px", background:"#1a0808", border:"1px solid #7f1d1d", borderRadius:3, marginBottom:9 }}>
                  <div style={{ fontSize:9, color:"#f87171", marginBottom:2 }}>⚠ Over capacity</div>
                  <div style={{ fontSize:9, color:"#4a5568" }}>
                    Carrying <span style={{ color:"#f87171" }}>{rate.toFixed(1)}/min</span> · needs Mk.{BELT_MARKS.find(b=>b.speed>=rate)?.mk??6}+
                  </div>
                </div>
              )}
              <button onClick={()=>{ pushHistory(); setConnections(prev=>prev.filter(c=>c.id!==selConn)); setSelConn(null); }}
                style={{ width:"100%", padding:"6px", background:"#1a0a0a", border:"1px solid #b91c1c", color:"#f87171", fontSize:9, borderRadius:3, cursor:"pointer", letterSpacing:1 }}>
                ✕ DELETE BELT
              </button>
            </div>
          );
        })():(
          <div style={{ padding:"22px 13px", textAlign:"center" }}>
            <div style={{ fontSize:24, opacity:.2, marginBottom:7 }}>↖</div>
            <div style={{ fontSize:10, color:"#4a5568", lineHeight:1.8 }}>Select a building or belt to view properties</div>
          </div>
        )}

        <div style={{ padding:"9px 13px", borderTop:"1px solid #1c2333" }}>
          <div style={{ fontSize:11, color:"#4a5568", letterSpacing:1, marginBottom:5 }}>BELT SPEEDS</div>
          {BELT_MARKS.map(b=>(
            <div key={b.mk} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
              <div style={{ width:13, height:2, background:b.color }} />
              <span style={{ fontSize:12, color:"#8b949e" }}>Mk.{b.mk} · <span style={{ color:b.color }}>{b.speed}/min</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Help modal */}
      {showHelp&&(
        <div style={{ position:"fixed", inset:0, background:"#000a", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setShowHelp(false)}>
          <div style={{ background:"#0d1117", border:"1px solid #2a3040", borderRadius:6, padding:24, maxWidth:440, color:"#c9d1d9", fontSize:12, lineHeight:1.9 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontFamily:"'Rajdhani'", fontSize:18, fontWeight:700, color:"#f0a500", marginBottom:4 }}>HOW TO USE PLANIT</div>
            <div style={{ fontSize:9, color:"#4a5568", marginBottom:11 }}>Certified spaghetti-free. Results may vary.</div>
            <b style={{ color:"#f0a500" }}>Pan:</b> Two-finger scroll (trackpad), middle-mouse drag, or Space+drag<br/>
            <b style={{ color:"#f0a500" }}>Zoom:</b> Pinch (trackpad), Ctrl+scroll, or +/− buttons. FIT to frame all buildings<br/>
            <b style={{ color:"#f0a500" }}>Place:</b> PLACE tool → pick building from sidebar → click grid<br/>
            <b style={{ color:"#f0a500" }}>Connect:</b> WIRE tool → pick belt mark → click source → click target<br/>
            <b style={{ color:"#f0a500" }}>Delete belt:</b> Click a belt → properties panel → DELETE BELT<br/>
            <b style={{ color:"#f0a500" }}>Ratio tab:</b> Type item name → autocomplete → set rate → Calculate<br/>
            <b style={{ color:"#f0a500" }}>Clock:</b> Select building → slider. 101–250% needs Power Shards<br/>
            <b style={{ color:"#f0a500" }}>Grid size:</b> W/H inputs in the sidebar footer<br/>
            <b style={{ color:"#f0a500" }}>Undo:</b> ↩ UNDO button or Ctrl+Z / Cmd+Z<br/>
            <div style={{ marginTop:10, fontSize:10, color:"#4a5568" }}>Click anywhere to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
