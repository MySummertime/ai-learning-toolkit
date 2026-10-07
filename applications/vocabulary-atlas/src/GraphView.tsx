import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { GraphData, RelationType, Theme, WordSummary } from './model';
import { relationLabels, relationTypes } from './model';
import FieldGuideArt from './FieldGuideArt';
type GraphEdge = GraphData['edges'][number];
const EMPTY_NODES: WordSummary[] = [];
const EMPTY_FAMILIES: GraphData['families'] = [];
const EMPTY_EDGES: GraphEdge[] = [];

type Props = {
  lookupMode: boolean; groupIndex: number; groupCount: number; onGroupChange: (index: number) => void;
  data: GraphData | null; theme: Theme; selected: string | null;
  zoom: number; positions: Record<string, { x: number; y: number }>;
  visible: Record<RelationType, boolean>;
  search: string; showOthers: boolean;
  showOutside: boolean; stageId: string; onShowOutside: () => void;
  onReturnToGraph: () => void;
  onOpenProjects: () => void;
  onSearch: (value: string) => void; onSelect: (id: string | null) => void;
  onOpenCandidate: (lemma: string) => void;
  onToggle: (kind: RelationType) => void; onShowOthers: () => void;
  onZoom: (value: number) => void; onPositions: (positions: Record<string, { x: number; y: number }>) => void;
  resetToken: number; fitToken: number; onInitialize: () => void;
};

const clampZoom = (value: number) => Math.min(400, Math.max(25, Math.round(value / 5) * 5));
const point = (cx: number, cy: number, radius: number, angle: number) => ({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
const cellSize = 240;
type Positions = Props['positions'];
const nodeRadius = (lemma: string, selected: string | null, id: string) => {
  const fontSize = id === selected ? 16 : 14;
  const textWidth = [...lemma].reduce((sum, char) => sum + (/^[\x00-\x7F]$/.test(char) ? fontSize * 0.62 : fontSize), 0);
  return Math.max(id === selected ? 38 : 32, Math.ceil(textWidth / 2 + 18));
};
function fitGraphView(nodes: WordSummary[], positions: Positions, selected: string | null) {
  if (!nodes.length) return { zoom: 100, pan: { x: 0, y: 0 } };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const position = positions[node.wordId];
    if (!position) continue;
    const radius = nodeRadius(node.lemma, selected, node.wordId) + 26;
    minX = Math.min(minX, position.x - radius); maxX = Math.max(maxX, position.x + radius);
    minY = Math.min(minY, position.y - radius); maxY = Math.max(maxY, position.y + radius);
  }
  if (!Number.isFinite(minX)) return { zoom: 100, pan: { x: 0, y: 0 } };
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const scale = Math.min(1, 900 / Math.max(1, maxX - minX), 600 / Math.max(1, maxY - minY));
  const zoom = clampZoom(scale * 100);
  const appliedScale = zoom / 100;
  return { zoom, pan: { x: (500 - centerX) * appliedScale, y: (350 - centerY) * appliedScale } };
}
const cross = (origin: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
  (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
function familyOutline(points: { x: number; y: number }[]) {
  if (!points.length) return '';
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: typeof sorted = [], upper: typeof sorted = [];
  for (const item of sorted) {
    while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], item) <= 0) lower.pop();
    lower.push(item);
  }
  for (const item of [...sorted].reverse()) {
    while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], item) <= 0) upper.pop();
    upper.push(item);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return '';
  const midpoint = (a: typeof hull[number], b: typeof hull[number]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let path = `M ${midpoint(hull[hull.length - 1], hull[0]).x} ${midpoint(hull[hull.length - 1], hull[0]).y}`;
  hull.forEach((item, index) => {
    const next = hull[(index + 1) % hull.length], middle = midpoint(item, next);
    path += ` Q ${item.x} ${item.y} ${middle.x} ${middle.y}`;
  });
  return `${path} Z`;
}
const curvedEdge = (a: { x: number; y: number }, b: { x: number; y: number }, bend: number) => {
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
  const direction = a.x < b.x || (a.x === b.x && a.y < b.y) ? 1 : -1;
  const amount = direction * Math.min(42, distance * 0.16) + bend;
  const cx = (a.x + b.x) / 2 - dy / distance * amount;
  const cy = (a.y + b.y) / 2 + dx / distance * amount;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
};

// Pack disks with the configured boundary gap, without overlapping disks.
// Translate each completed family cluster as one rigid group.
function packFamily(members: string[], positions: Positions, selected: string | null, familyNodeGap: number, lemmas: Record<string, string>) {
  if (members.length < 2) return;
  const center = { x: members.reduce((sum, id) => sum + positions[id].x, 0) / members.length,
    y: members.reduce((sum, id) => sum + positions[id].y, 0) / members.length };
  const ordered = [...members].sort((a, b) => Number(b === selected) - Number(a === selected) || a.localeCompare(b));
  const packed: Positions = { [ordered[0]]: { x: 0, y: 0 } };
  const placed = [ordered[0]];
  const cells = spatialBuckets(placed, packed);
  const maxRadius = Math.max(...members.map(id => nodeRadius(lemmas[id] || id, selected, id)));
  for (const id of ordered.slice(1)) {
    let best: { x: number; y: number } | null = null;
    let score = Infinity;
    for (const anchor of placed) for (let angle = 0; angle < 12; angle++) {
      const candidate = point(packed[anchor].x, packed[anchor].y,
        nodeRadius(lemmas[id] || id, selected, id) + nodeRadius(lemmas[anchor] || anchor, selected, anchor) + familyNodeGap, angle * Math.PI / 6);
      const distance = candidate.x ** 2 + candidate.y ** 2;
      if (distance >= score) continue;
      if (nearby(cells, candidate.x, candidate.y, nodeRadius(lemmas[id] || id, selected, id) + maxRadius + familyNodeGap).some(other =>
        Math.hypot(candidate.x - packed[other].x, candidate.y - packed[other].y) <
        nodeRadius(lemmas[id] || id, selected, id) + nodeRadius(lemmas[other] || other, selected, other) + familyNodeGap - 0.001)) continue;
      best = candidate; score = distance;
    }
    if (!best) throw new Error('词谱布局失败，请刷新页面重试。');
    packed[id] = best; placed.push(id);
    const key = `${Math.floor(best.x / cellSize)},${Math.floor(best.y / cellSize)}`;
    const cell = cells.get(key) || []; cell.push(id); cells.set(key, cell);
  }
  const mean = { x: placed.reduce((sum, id) => sum + packed[id].x, 0) / placed.length,
    y: placed.reduce((sum, id) => sum + packed[id].y, 0) / placed.length };
  for (const id of placed) positions[id] = { x: center.x + packed[id].x - mean.x, y: center.y + packed[id].y - mean.y };
}
function spatialBuckets(ids: string[], positions: Positions) {
  const cells = new Map<string, string[]>();
  for (const id of ids) {
    const position = positions[id];
    if (!position) continue;
    const key = `${Math.floor(position.x / cellSize)},${Math.floor(position.y / cellSize)}`;
    const members = cells.get(key) || [];
    members.push(id); cells.set(key, members);
  }
  return cells;
}
function nearby(cells: Map<string, string[]>, x: number, y: number, radius: number) {
  const result: string[] = [];
  for (let column = Math.floor((x - radius) / cellSize); column <= Math.floor((x + radius) / cellSize); column++) {
    for (let row = Math.floor((y - radius) / cellSize); row <= Math.floor((y + radius) / cellSize); row++) {
      result.push(...(cells.get(`${column},${row}`) || []));
    }
  }
  return result;
}

function familyContactsHold(families: GraphData['families'], positions: Positions, selected: string | null, familyNodeGap: number, lemmas: Record<string, string>) {
  return families.every(family => {
    const members = family.nodeIds;
    if (members.length < 2) return true;
    return members.every(id => {
      if (!positions[id]) return false;
      let touches = false;
      for (const other of members) {
        if (other === id) continue;
        if (!positions[other]) return false;
        const gap = Math.hypot(positions[id].x - positions[other].x, positions[id].y - positions[other].y)
          - nodeRadius(lemmas[id] || id, selected, id) - nodeRadius(lemmas[other] || other, selected, other) - familyNodeGap;
        if (gap < -0.01) return false;
        if (Math.abs(gap) <= 0.01) touches = true;
      }
      return touches;
    });
  });
}

function initialPositions(nodes: WordSummary[], families: GraphData['families'], selected: string | null, saved: Props['positions']) {
  const result: Record<string, { x: number; y: number }> = {};
  const familyIds = new Set(families.flatMap(family => family.nodeIds));
  if (selected) {
    result[selected] = saved[selected] || { x: 500, y: 350 };
    const ownFamily = new Set(families.find(family => family.nodeIds.includes(selected))?.nodeIds || [selected]);
    const members = nodes.filter(node => node.wordId !== selected && ownFamily.has(node.wordId));
    members.forEach((node, index) => {
      const proposed = point(500, 350, 92, (2 * Math.PI * index) / members.length - Math.PI / 2);
      const stored = saved[node.wordId];
      result[node.wordId] = stored || proposed;
    });
    const neighbors = nodes.filter(node => !ownFamily.has(node.wordId));
    neighbors.forEach((node, index) => {
      const ring = Math.floor(index / 12);
      const slot = index % 12;
      const count = Math.min(12, neighbors.length - ring * 12);
      const proposed = point(500, 350, 265 + ring * 110, (2 * Math.PI * slot) / count - Math.PI / 2);
      const stored = saved[node.wordId];
      result[node.wordId] = stored || proposed;
    });
  } else {
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(families.length))));
    families.forEach((family, index) => {
      const members = nodes.filter(node => family.nodeIds.includes(node.wordId));
      const center = { x: 170 + (index % cols) * 300, y: 140 + Math.floor(index / cols) * 280 };
      members.forEach((node, slot) => {
        const proposed = members.length === 1 ? center : point(center.x, center.y, 74, (slot * Math.PI * 2) / members.length);
        const stored = saved[node.wordId];
        result[node.wordId] = stored || proposed;
      });
    });
    const outsiders = nodes.filter(node => !familyIds.has(node.wordId));
    const outsideY = 230 + Math.ceil(families.length / cols) * 280;
    outsiders.forEach((node, index) => {
      const proposed = { x: 100 + (index % 5) * 190, y: outsideY + Math.floor(index / 5) * 105 };
      const stored = saved[node.wordId];
      result[node.wordId] = stored || proposed;
    });
  }
  return result;
}

function settlePositions(nodes: WordSummary[], edges: GraphEdge[], families: GraphData['families'],
  initial: Props['positions'], physics: Props['theme']['graph']['physics'], steps = 24, selected: string | null = null) {
  const next = Object.fromEntries(Object.entries(initial).map(([id, position]) => [id, { ...position }]));
  const nodeIds = nodes.map(node => node.wordId);
  const lemmas = Object.fromEntries(nodes.map(node => [node.wordId, node.lemma]));
  const nodeOrder = new Map(nodeIds.map((id, index) => [id, index]));
  const groups = families.map(family => family.nodeIds.filter(id => next[id])).filter(members => members.length);
  const geometry = (members: string[]) => {
    const center = { x: members.reduce((sum, id) => sum + next[id].x, 0) / members.length,
      y: members.reduce((sum, id) => sum + next[id].y, 0) / members.length };
    const radius = Math.max(64, ...members.map(id => Math.hypot(next[id].x - center.x, next[id].y - center.y) + nodeRadius(lemmas[id] || id, selected, id)));
    return { center, radius };
  };
  for (let step = 0; step < steps; step++) {
    const forces: Record<string, { x: number; y: number }> = Object.fromEntries(nodeIds.map(id => [id, { x: 0, y: 0 }]));
    for (const edge of edges) {
      const a = next[edge.source], b = next[edge.target];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const force = Math.max(-8, Math.min(8, (distance - physics.restLength) * physics.springStrength));
      forces[edge.source].x += force * dx / distance; forces[edge.source].y += force * dy / distance;
      forces[edge.target].x -= force * dx / distance; forces[edge.target].y -= force * dy / distance;
    }
    for (const members of groups) {
      const { center } = geometry(members);
      const compactRadius = Math.max(32, Math.sqrt(members.length) * 24);
      for (const id of members) {
        const dx = center.x - next[id].x, dy = center.y - next[id].y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = Math.max(0, distance - compactRadius) * physics.springStrength * 3;
        forces[id].x += force * dx / distance; forces[id].y += force * dy / distance;
      }
    }
    const repulsionCells = spatialBuckets(nodeIds, next);
    for (let i = 0; i < nodeIds.length; i++) for (const otherId of nearby(repulsionCells, next[nodeIds[i]].x, next[nodeIds[i]].y, 300)) {
      const j = nodeOrder.get(otherId) ?? -1;
      if (j <= i) continue;
      const a = next[nodeIds[i]], b = next[otherId];
      const dx = a.x - b.x, dy = a.y - b.y, distance2 = Math.max(100, dx * dx + dy * dy);
      if (distance2 > 90000) continue;
      const force = physics.repulsionStrength / (distance2 * Math.sqrt(distance2)) + Math.max(0, 90 - Math.sqrt(distance2)) * 0.2 / Math.sqrt(distance2);
      forces[nodeIds[i]].x += force * dx; forces[nodeIds[i]].y += force * dy;
      forces[otherId].x -= force * dx; forces[otherId].y -= force * dy;
    }
    for (const id of nodeIds) {
      next[id].x += Math.max(-12, Math.min(12, forces[id].x * physics.damping));
      next[id].y += Math.max(-12, Math.min(12, forces[id].y * physics.damping));
    }
    // Keep family circles separate and exclude nodes from other families.
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = geometry(groups[i]), b = geometry(groups[j]);
      const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const overlap = a.radius + b.radius + 18 - distance;
      if (overlap <= 0) continue;
      const direction = distance === 1 ? { x: 1, y: 0 } : { x: dx / distance, y: dy / distance };
      const shift = Math.min(18, overlap * physics.familyNonMemberRepulsionStrength / 5000);
      for (const id of groups[i]) { next[id].x -= direction.x * shift; next[id].y -= direction.y * shift; }
      for (const id of groups[j]) { next[id].x += direction.x * shift; next[id].y += direction.y * shift; }
    }
    const exclusionCells = spatialBuckets(nodeIds, next);
    for (const members of groups) {
      const { center, radius } = geometry(members), own = new Set(members);
      for (const id of nearby(exclusionCells, center.x, center.y, radius + 36)) {
        if (own.has(id)) continue;
        const dx = next[id].x - center.x, dy = next[id].y - center.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance >= radius + 36) continue;
        const angle = distance === 1 ? ((nodeOrder.get(id) ?? 0) * 2.39996) : Math.atan2(dy, dx);
        const shift = Math.min(24, (radius + 36 - distance) * physics.familyNonMemberRepulsionStrength / 5000);
        next[id].x += Math.cos(angle) * shift; next[id].y += Math.sin(angle) * shift;
      }
    }
  }
  for (const members of groups) packFamily(members, next, selected, physics.familyNodeGap, lemmas);
  const grouped = new Set(groups.flat());
  const rigidGroups = [...groups, ...nodeIds.filter(id => !grouped.has(id)).map(id => [id])];
  const shapes = rigidGroups.map(geometry);
  const shapeIds = shapes.map((_, index) => String(index));
  const centers = Object.fromEntries(shapes.map((shape, index) => [String(index), shape.center]));
  const shapeCells = spatialBuckets(shapeIds, centers);
  const maxRadius = Math.max(0, ...shapes.map(shape => shape.radius));
  const moveGroup = (index: number, dx: number, dy: number) => {
    const id = String(index), center = shapes[index].center;
    const oldKey = `${Math.floor(center.x / cellSize)},${Math.floor(center.y / cellSize)}`;
    center.x += dx; center.y += dy;
    for (const nodeId of rigidGroups[index]) { next[nodeId].x += dx; next[nodeId].y += dy; }
    const newKey = `${Math.floor(center.x / cellSize)},${Math.floor(center.y / cellSize)}`;
    if (oldKey === newKey) return;
    shapeCells.set(oldKey, (shapeCells.get(oldKey) || []).filter(member => member !== id));
    const cell = shapeCells.get(newKey) || []; cell.push(id); shapeCells.set(newKey, cell);
  };
  // Move family clusters as rigid groups while resolving overlaps.
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < rigidGroups.length; i++) for (const otherId of
      nearby(shapeCells, shapes[i].center.x, shapes[i].center.y, shapes[i].radius + maxRadius + 18)) {
      const j = Number(otherId);
      if (j <= i) continue;
      const a = shapes[i], b = shapes[j];
      const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
      const distance = Math.hypot(dx, dy), overlap = a.radius + b.radius + 18 - distance;
      if (overlap <= 0.001) continue;
      const angle = distance < 0.01 ? (i + j) * 2.39996 : Math.atan2(dy, dx);
      const sx = Math.cos(angle) * (overlap / 2 + 0.001), sy = Math.sin(angle) * (overlap / 2 + 0.001);
      moveGroup(i, -sx, -sy); moveGroup(j, sx, sy);
      moved = true;
    }
    if (!moved) break;
  }
  return next;
}

export default function GraphView(props: Props) {
  const { data, theme, selected, positions, visible, search, showOthers, showOutside, stageId } = props;
  const [zoom, setZoom] = useState(props.zoom);
  const [toolPosition, setToolPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const stored = window.localStorage.getItem('vocabulary-atlas:graph-tools-position');
      if (!stored) return null;
      const position = JSON.parse(stored) as { x?: number; y?: number };
      return Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: Math.min(1, Math.max(0, position.x as number)), y: Math.min(1, Math.max(0, position.y as number)) }
        : null;
    } catch { return null; }
  });
  const toolPositionRef = useRef(toolPosition);
  const toolDrag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const graphStageRef = useRef<HTMLDivElement>(null);
  const toolsIslandRef = useRef<HTMLDivElement>(null);
  const zoomSaveTimer = useRef<number | null>(null);
  const latestZoom = useRef(props.zoom);
  const zoomHandler = useRef(props.onZoom);
  zoomHandler.current = props.onZoom;
  useEffect(() => { latestZoom.current = props.zoom; setZoom(props.zoom); }, [props.zoom]);
  useEffect(() => () => {
    if (zoomSaveTimer.current !== null) {
      window.clearTimeout(zoomSaveTimer.current);
      zoomHandler.current(latestZoom.current);
    }
  }, []);
  const changeZoom = (value: number) => {
    const next = clampZoom(value);
    latestZoom.current = next;
    setZoom(next);
    if (baseline.current) baseline.current = { ...baseline.current, zoom: next };
    if (zoomSaveTimer.current !== null) window.clearTimeout(zoomSaveTimer.current);
    zoomSaveTimer.current = window.setTimeout(() => {
      zoomSaveTimer.current = null;
      zoomHandler.current(next);
    }, 120);
  };
  const startToolDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const stage = graphStageRef.current, island = toolsIslandRef.current;
    if (!stage || !island) return;
    const bounds = stage.getBoundingClientRect(), islandBounds = island.getBoundingClientRect();
    const current = toolPositionRef.current || {
      x: (islandBounds.left + islandBounds.width / 2 - bounds.left) / bounds.width,
      y: (islandBounds.top + islandBounds.height / 2 - bounds.top) / bounds.height,
    };
    toolDrag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveToolDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = toolDrag.current, stage = graphStageRef.current, island = toolsIslandRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !stage || !island) return;
    const bounds = stage.getBoundingClientRect(), islandBounds = island.getBoundingClientRect();
    const halfWidth = islandBounds.width / 2, halfHeight = islandBounds.height / 2;
    const centerX = Math.min(bounds.width - halfWidth, Math.max(halfWidth, drag.originX * bounds.width + event.clientX - drag.startX));
    const centerY = Math.min(bounds.height - halfHeight, Math.max(halfHeight, drag.originY * bounds.height + event.clientY - drag.startY));
    const next = { x: centerX / bounds.width, y: centerY / bounds.height };
    toolPositionRef.current = next;
    setToolPosition(next);
  };
  const finishToolDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (toolDrag.current?.pointerId !== event.pointerId) return;
    toolDrag.current = null;
    try {
      if (toolPositionRef.current) window.localStorage.setItem('vocabulary-atlas:graph-tools-position', JSON.stringify(toolPositionRef.current));
    } catch { /* Keep the current position for this session if browser storage is unavailable. */ }
  };
  const moveToolWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 },
    };
    const delta = deltas[event.key], stage = graphStageRef.current, island = toolsIslandRef.current;
    if (!delta || !stage || !island) return;
    event.preventDefault();
    const bounds = stage.getBoundingClientRect(), islandBounds = island.getBoundingClientRect();
    const current = toolPositionRef.current || {
      x: (islandBounds.left + islandBounds.width / 2 - bounds.left) / bounds.width,
      y: (islandBounds.top + islandBounds.height / 2 - bounds.top) / bounds.height,
    };
    const centerX = Math.min(bounds.width - islandBounds.width / 2, Math.max(islandBounds.width / 2, current.x * bounds.width + delta.x));
    const centerY = Math.min(bounds.height - islandBounds.height / 2, Math.max(islandBounds.height / 2, current.y * bounds.height + delta.y));
    const next = { x: centerX / bounds.width, y: centerY / bounds.height };
    toolPositionRef.current = next;
    setToolPosition(next);
    try { window.localStorage.setItem('vocabulary-atlas:graph-tools-position', JSON.stringify(next)); } catch { /* Keep the current position for this session. */ }
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const closeOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const closeOnPointerLeave = (event: globalThis.PointerEvent) => {
      const root = filtersRef.current;
      const summary = root?.querySelector('summary');
      const panel = root?.querySelector('.graph-filters');
      if (!root || !summary || !panel) return;
      const a = summary.getBoundingClientRect(), b = panel.getBoundingClientRect();
      const padding = 8;
      const left = Math.min(a.left, b.left) - padding, right = Math.max(a.right, b.right) + padding;
      const top = Math.min(a.top, b.top) - padding, bottom = Math.max(a.bottom, b.bottom) + padding;
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) setFiltersOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('pointermove', closeOnPointerLeave);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('pointermove', closeOnPointerLeave);
    };
  }, [filtersOpen]);
  useEffect(() => { setFiltersOpen(false); }, [props.selected, props.resetToken]);
  const [showGuide, setShowGuide] = useState(false);
  const dismissGuide = () => setShowGuide(false);
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({});
  const [collisionPulses, setCollisionPulses] = useState<Record<string, number>>({});
  const collisionSequence = useRef(0);
  const liveRef = useRef<Record<string, { x: number; y: number }>>({});
  const velocity = useRef<Record<string, { x: number; y: number }>>({});
  const pendingFrame = useRef<number | null>(null);
  const settlementFrame = useRef<number | null>(null);
  const settlementTarget = useRef<Positions | null>(null);
  const layoutGeneration = useRef(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const focusFrame = useRef<number | null>(null);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => () => { if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current); }, []);
  const focusPan = (target: { x: number; y: number }) => {
    if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setPan(target); return; }
    const start = panRef.current;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 240);
      const eased = 1 - Math.pow(1 - progress, 3);
      setPan({ x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased });
      focusFrame.current = progress < 1 ? window.requestAnimationFrame(step) : null;
    };
    focusFrame.current = window.requestAnimationFrame(step);
  };
  const [edgeDetails, setEdgeDetails] = useState<GraphEdge | null>(null);
  const drag = useRef<{ kind: 'node' | 'canvas'; id?: string; x: number; y: number; origin: { x: number; y: number }; latest?: { x: number; y: number }; anchor?: { x: number; y: number }; startPositions?: Positions; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const lastReset = useRef(0);
  const lastFit = useRef(0);
  const baseline = useRef<{ positions: Positions; pan: { x: number; y: number }; zoom: number } | null>(null);
  const previousSelected = useRef<string | null>(selected);
  const nodes = data?.nodes || EMPTY_NODES;
  const families = data?.families || EMPTY_FAMILIES;
  const edges = data?.edges || EMPTY_EDGES;
  useEffect(() => {
    const stage = graphStageRef.current, island = toolsIslandRef.current;
    if (!stage || !island) return;
    const keepIslandInsideMap = () => {
      const current = toolPositionRef.current;
      if (!current) return;
      const stageBounds = stage.getBoundingClientRect(), islandBounds = island.getBoundingClientRect();
      const x = Math.min(stageBounds.width - islandBounds.width / 2 - 8, Math.max(islandBounds.width / 2 + 8, current.x * stageBounds.width));
      const y = Math.min(stageBounds.height - islandBounds.height / 2 - 8, Math.max(islandBounds.height / 2 + 8, current.y * stageBounds.height));
      const next = { x: x / stageBounds.width, y: y / stageBounds.height };
      if (Math.abs(next.x - current.x) < 0.001 && Math.abs(next.y - current.y) < 0.001) return;
      toolPositionRef.current = next;
      setToolPosition(next);
      try { window.localStorage.setItem('vocabulary-atlas:graph-tools-position', JSON.stringify(next)); } catch { /* Keep the corrected position for this session. */ }
    };
    const observer = new ResizeObserver(keepIslandInsideMap);
    observer.observe(stage);
    observer.observe(island);
    keepIslandInsideMap();
    return () => observer.disconnect();
  }, [nodes.length]);
  const layoutKey = useMemo(() => JSON.stringify([
    selected,
    nodes.map(node => node.wordId),
    families.map(family => [family.familyId, family.nodeIds]),
    edges.map(edge => [edge.relationshipId, edge.source, edge.target, edge.type]),
  ]), [nodes, families, edges, selected]);
  const previousLayoutSource = useRef({ layoutKey, physics: theme.graph.physics });
  const nodeIds = useMemo(() => nodes.map(node => node.wordId), [nodes]);
  const connected = useMemo(() => {
    const result = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      for (const id of [edge.source, edge.target]) {
        const items = result.get(id) || [];
        items.push(edge); result.set(id, items);
      }
    }
    return result;
  }, [edges]);
  const overviewEdgeOffsets = useMemo(() => {
    if (selected) return new Map<GraphEdge, number>();
    const pairs = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      const key = JSON.stringify([edge.source, edge.target].sort());
      const items = pairs.get(key) || []; items.push(edge); pairs.set(key, items);
    }
    const offsets = new Map<GraphEdge, number>();
    for (const items of pairs.values()) items.forEach((edge, index) => {
      offsets.set(edge, (index - (items.length - 1) / 2) * 6 * (edge.source < edge.target ? 1 : -1));
    });
    return offsets;
  }, [edges, selected]);
  useEffect(() => () => {
    if (pendingFrame.current !== null) window.cancelAnimationFrame(pendingFrame.current);
    if (settlementFrame.current !== null) window.cancelAnimationFrame(settlementFrame.current);
    if (settlementTarget.current) props.onPositions(settlementTarget.current);
  }, []);
  const layout = useMemo(() => initialPositions(nodes, families, selected, positions), [nodes, families, selected, positions]);
  useEffect(() => {
    const generation = ++layoutGeneration.current;
    const prior = previousLayoutSource.current;
    const sameSource = prior.layoutKey === layoutKey && prior.physics === theme.graph.physics;
    previousLayoutSource.current = { layoutKey, physics: theme.graph.physics };
    if (props.resetToken > lastReset.current) return;
    if (sameSource && nodes.length && nodes.every(node => {
      const current = liveRef.current[node.wordId], saved = positions[node.wordId];
      return current && saved && current.x === saved.x && current.y === saved.y;
    })) return;
    const timer = window.setTimeout(() => {
      if (generation !== layoutGeneration.current) return;
      const restored = !selected && baseline.current ? { ...layout, ...baseline.current.positions } : null;
      const physicsChanged = prior.physics !== theme.graph.physics;
      const settled = restored && !physicsChanged && familyContactsHold(families, restored, selected, theme.graph.physics.familyNodeGap, Object.fromEntries(nodes.map(node => [node.wordId, node.lemma])))
        ? restored
        : settlePositions(nodes, edges, families, restored || layout, theme.graph.physics, restored && !physicsChanged ? 0 : 8, selected);
      if (generation !== layoutGeneration.current) return;
      if (pendingFrame.current !== null) { window.cancelAnimationFrame(pendingFrame.current); pendingFrame.current = null; }
      liveRef.current = settled; velocity.current = {}; setLive(settled);
      if (!selected && !baseline.current && nodes.length) baseline.current = { positions: settled, pan: { x: 0, y: 0 }, zoom };
    }, 0);
    return () => { window.clearTimeout(timer); layoutGeneration.current++; };
  }, [layout, edges, families, theme.graph.physics, selected, props.resetToken, layoutKey]);
  useEffect(() => {
    if (!nodes.length || props.resetToken <= lastReset.current) return;
    const timer = window.setTimeout(() => {
      if (props.resetToken <= lastReset.current) return;
      const scattered = Object.fromEntries(nodes.map(node => [node.wordId, {
        x: 500 + (Math.random() - 0.5) * 220, y: 350 + (Math.random() - 0.5) * 160,
      }]));
      const settled = settlePositions(nodes, edges, families, scattered, theme.graph.physics, 16, selected);
      if (pendingFrame.current !== null) { window.cancelAnimationFrame(pendingFrame.current); pendingFrame.current = null; }
      lastReset.current = props.resetToken;
      liveRef.current = settled; velocity.current = {}; setLive(settled);
      const fitted = fitGraphView(nodes, settled, selected);
      panRef.current = fitted.pan; setPan(fitted.pan); changeZoom(fitted.zoom);
      baseline.current = { positions: settled, pan: fitted.pan, zoom: fitted.zoom };
      props.onPositions(settled);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.resetToken, nodes, edges, families, theme.graph.physics]);
  useEffect(() => {
    if (props.fitToken < 1 || props.fitToken <= lastFit.current || !nodes.length) return;
    const fitToken = props.fitToken;
    const frame = window.requestAnimationFrame(() => {
      if (fitToken <= lastFit.current) return;
      const fittedPositions = Object.fromEntries(nodes.flatMap(node => {
        const position = liveRef.current[node.wordId] || layout[node.wordId];
        return position ? [[node.wordId, position]] : [];
      }));
      const fitted = fitGraphView(nodes, fittedPositions, selected);
      panRef.current = fitted.pan; setPan(fitted.pan); changeZoom(fitted.zoom);
      baseline.current = { positions: fittedPositions, pan: fitted.pan, zoom: fitted.zoom };
      lastFit.current = fitToken;
      props.onPositions(fittedPositions);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.fitToken, nodes]);
  const place = (id: string) => live[id] || layout[id] || { x: 500, y: 350 };
  const nodeById = Object.fromEntries(nodes.map(node => [node.wordId, node]));
  const senseLabel = (wordId: string, senseId?: string) => {
    const node = nodeById[wordId];
    if (!node || !senseId) return '词条级';
    return [...node.core, ...node.more].find(sense => sense.senseId === senseId)?.text || '义项';
  };
  // familyId is the graph's canonical family anchor. nodeIds are sorted for stable
  // rendering, so their first item is not necessarily the family center.
  const familyCenters = new Set(families
    .filter(family => family.nodeIds.length > 1 && family.nodeIds.includes(family.familyId))
    .map(family => family.familyId));
  const colorOf = (node: WordSummary) => familyCenters.has(node.wordId)
    ? theme.graph.family
    : node.outsideStage ? theme.graph.nodes.outside : theme.graph.nodes.entry;
  const relationColor = (kind: RelationType) => kind === 'family' ? theme.graph.family : theme.graph.relations[kind];
  const selectedNode = selected ? nodeById[selected] : null;
  const animateSettlement = (target: Positions) => {
    if (settlementFrame.current !== null) window.cancelAnimationFrame(settlementFrame.current);
    settlementTarget.current = target;
    const start = Object.fromEntries(nodeIds.map(id => [id, { ...(liveRef.current[id] || target[id]) }]));
    const impacts = new Set<string>();
    for (let i = 0; i < nodeIds.length; i++) for (let j = i + 1; j < nodeIds.length; j++) {
      const left = nodeIds[i], right = nodeIds[j];
      const a = start[left], b = start[right], nextA = target[left], nextB = target[right];
      const gap = nodeRadius(nodeById[left].lemma, selected, left) + nodeRadius(nodeById[right].lemma, selected, right);
      const before = Math.hypot(a.x - b.x, a.y - b.y), after = Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y);
      if (before < gap + 8 && after > before + 2) { impacts.add(left); impacts.add(right); }
    }
    if (impacts.size) {
      const pulse = ++collisionSequence.current;
      setCollisionPulses(current => ({ ...current, ...Object.fromEntries([...impacts].map(id => [id, pulse])) }));
    }
    const finish = () => {
      liveRef.current = target; velocity.current = {}; setLive(target);
      baseline.current = { positions: target, pan: baseline.current?.pan || { x: 0, y: 0 }, zoom: baseline.current?.zoom || zoom };
      props.onPositions(target);
      settlementTarget.current = null;
      settlementFrame.current = null;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const started = performance.now();
    const animate = (now: number) => {
      const time = Math.min(1, (now - started) / 620);
      const eased = 1 - Math.exp(-7 * time) * (Math.cos(10 * time) + 0.7 * Math.sin(10 * time));
      const frame = Object.fromEntries(nodeIds.map(id => [id, {
        x: start[id].x + (target[id].x - start[id].x) * eased,
        y: start[id].y + (target[id].y - start[id].y) * eased,
      }]));
      liveRef.current = frame; setLive(frame);
      if (time < 1) settlementFrame.current = window.requestAnimationFrame(animate);
      else finish();
    };
    settlementFrame.current = window.requestAnimationFrame(animate);
  };
  const completeSettlement = () => {
    const target = settlementTarget.current;
    if (!target) return;
    if (settlementFrame.current !== null) window.cancelAnimationFrame(settlementFrame.current);
    settlementFrame.current = null; settlementTarget.current = null;
    liveRef.current = target; velocity.current = {}; setLive(target);
    baseline.current = { positions: target, pan: baseline.current?.pan || { x: 0, y: 0 }, zoom: baseline.current?.zoom || zoom };
    props.onPositions(target);
  };

  useEffect(() => {
    if (!selected) {
      if (previousSelected.current && baseline.current) {
        liveRef.current = baseline.current.positions;
        setLive(baseline.current.positions);
        focusPan(baseline.current.pan);
      }
      previousSelected.current = null;
      return;
    }
    previousSelected.current = selected;
    const center = liveRef.current[selected] || layout[selected] || { x: 500, y: 350 };
    focusPan({ x: (500 - center.x) * zoom / 100, y: (350 - center.y) * zoom / 100 });
  }, [selected, data?.selected]);

  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - drag.current.x) * 1000 / bounds.width;
    const dy = (event.clientY - drag.current.y) * 700 / bounds.height;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    if (drag.current.kind === 'canvas' && drag.current.anchor && drag.current.startPositions) {
      const scale = zoom / 100;
      const moveX = dx / scale, moveY = dy / scale;
      const next: Positions = {};
      for (const node of nodes) {
        const initial = drag.current.startPositions[node.wordId];
        if (!initial) continue;
        const distance = Math.hypot(initial.x - drag.current.anchor.x, initial.y - drag.current.anchor.y);
        const influence = 0.18 + 0.82 * Math.exp(-distance / 430);
        next[node.wordId] = { x: initial.x + moveX * influence, y: initial.y + moveY * influence };
      }
      liveRef.current = next;
      if (pendingFrame.current === null) pendingFrame.current = window.requestAnimationFrame(() => {
        pendingFrame.current = null; setLive({ ...liveRef.current });
      });
    }
    else if (drag.current.id) {
      const position = { x: drag.current.origin.x + dx / (zoom / 100), y: drag.current.origin.y + dy / (zoom / 100) };
      const id = drag.current.id;
      const previousPosition = liveRef.current[id] || drag.current.latest || drag.current.origin;
      drag.current.latest = position;
      const physics = theme.graph.physics;
      const next = { ...layout, ...liveRef.current, [id]: position };
      const draggedOrigin = drag.current.origin;
      if (drag.current.moved) {
        const moveX = position.x - previousPosition.x, moveY = position.y - previousPosition.y;
        const moveLength2 = moveX * moveX + moveY * moveY;
        if (moveLength2 > 9) {
          const impacts: string[] = [];
          for (const other of nodes) {
            if (other.wordId === id || !next[other.wordId]) continue;
            const point = next[other.wordId];
            const t = Math.max(0, Math.min(1, ((point.x - previousPosition.x) * moveX + (point.y - previousPosition.y) * moveY) / moveLength2));
            const distance = Math.hypot(point.x - previousPosition.x - t * moveX, point.y - previousPosition.y - t * moveY);
            const contactDistance = nodeRadius(nodeById[id]?.lemma || id, selected, id) + nodeRadius(other.lemma, selected, other.wordId);
            const wasOutside = Math.hypot(point.x - previousPosition.x, point.y - previousPosition.y) > contactDistance;
            if (wasOutside && distance <= contactDistance) impacts.push(other.wordId);
          }
          if (impacts.length) {
            const pulse = ++collisionSequence.current;
            setCollisionPulses(current => ({ ...current, [id]: pulse, ...Object.fromEntries(impacts.map(otherId => [otherId, pulse])) }));
          }
        }
      }
      for (let step = 0; step < 5; step++) {
        const cells = spatialBuckets(nodeIds, next);
        for (const node of nodes) {
          const key = node.wordId;
          if (key === id) continue;
          const here = next[key];
          if (!here) continue;
          const distanceFromDrag = Math.max(1, Math.hypot(here.x - position.x, here.y - position.y));
          const influence = Math.min(1, (physics.restLength * physics.restLength) /
            (distanceFromDrag * distanceFromDrag));
          let fx = 0, fy = 0;
          for (const edge of connected.get(key) || []) {
            const other = next[edge.source === key ? edge.target : edge.source];
            if (!other) continue;
            const dx = other.x - here.x, dy = other.y - here.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const force = (distance - physics.restLength) * physics.springStrength;
            fx += force * dx / distance; fy += force * dy / distance;
          }
          for (const otherId of nearby(cells, here.x, here.y, 300)) {
            if (otherId === key) continue;
            const other = next[otherId];
            if (!other) continue;
            const dx = here.x - other.x, dy = here.y - other.y;
            const distance2 = Math.max(100, dx * dx + dy * dy);
            if (distance2 > 90000) continue;
            fx += physics.repulsionStrength * dx / (distance2 * Math.sqrt(distance2));
            fy += physics.repulsionStrength * dy / (distance2 * Math.sqrt(distance2));
          }
          const ownFamily = families.find(family => family.nodeIds.includes(key));
          if (ownFamily) {
            const members = ownFamily.nodeIds.filter(member => next[member]);
            const cx = members.reduce((sum, member) => sum + next[member].x, 0) / members.length;
            const cy = members.reduce((sum, member) => sum + next[member].y, 0) / members.length;
            const dx = cx - here.x, dy = cy - here.y, distance = Math.max(1, Math.hypot(dx, dy));
            const force = Math.max(0, distance - Math.max(32, Math.sqrt(members.length) * 24)) * physics.springStrength * 3;
            fx += force * dx / distance; fy += force * dy / distance;
          }
          const prior = velocity.current[key] || { x: 0, y: 0 };
          const speed = { x: (prior.x + fx) * physics.damping * influence,
            y: (prior.y + fy) * physics.damping * influence };
          velocity.current[key] = speed;
          next[key] = { x: here.x + speed.x + (position.x - draggedOrigin.x) * influence * 0.002,
            y: here.y + speed.y + (position.y - draggedOrigin.y) * influence * 0.002 };
        }
      }
      liveRef.current = next;
      if (pendingFrame.current === null) pendingFrame.current = window.requestAnimationFrame(() => {
        pendingFrame.current = null; setLive({ ...liveRef.current });
      });
    }
  };
  const pointerUp = () => {
    if (pendingFrame.current !== null) { window.cancelAnimationFrame(pendingFrame.current); pendingFrame.current = null; }
    if (drag.current?.moved) {
      const settled = settlePositions(nodes, edges, families, liveRef.current, theme.graph.physics, 18, selected);
      animateSettlement(settled);
    }
    suppressClick.current = !!drag.current?.moved;
    drag.current = null;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  };
  const startNode = (event: PointerEvent<SVGGElement>, id: string) => {
    event.stopPropagation();
    completeSettlement();
    if (focusFrame.current !== null) { window.cancelAnimationFrame(focusFrame.current); focusFrame.current = null; }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: 'node', id, x: event.clientX, y: event.clientY, origin: place(id), moved: false };
  };
  const startCanvas = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && (event.target as Element).tagName.toLowerCase() !== 'rect') return;
    if (focusFrame.current !== null) { window.cancelAnimationFrame(focusFrame.current); focusFrame.current = null; }
    completeSettlement();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = zoom / 100;
    const screenX = (event.clientX - bounds.left) * 1000 / bounds.width;
    const screenY = (event.clientY - bounds.top) * 700 / bounds.height;
    const anchor = { x: 500 + (screenX - pan.x - 500) / scale, y: 350 + (screenY - pan.y - 350) / scale };
    const startPositions = Object.fromEntries(nodes.map(node => [node.wordId, { ...(liveRef.current[node.wordId] || layout[node.wordId]) }]));
    drag.current = { kind: 'canvas', x: event.clientX, y: event.clientY, origin: pan, anchor, startPositions, moved: false };
  };

  return <section className="graph-panel" aria-label="词汇地图">
    <div className="graph-toolbar">
      <div className="graph-topline">
        <div className="graph-title">
          <strong>词汇地图</strong>
          {props.lookupMode && <span>{nodeById[selected || ""]?.lemma}</span>}
          {nodes.length > 0 && <small>显示 {nodes.length} / {(data?.entryCount || 0) + (data?.placeholderCount || 0) + (data?.hiddenCount || 0)} 个单词</small>}
        </div>
        {nodes.length > 0 && <div className="graph-main-actions">
          {(selected || search) && <button type="button" className="filter-chip" onClick={props.onReturnToGraph}>← 返回地图</button>}
          <button type="button" className="filter-chip" onClick={() => props.onInitialize()}>重置布局</button>
          <button type="button" className="filter-chip" onClick={() => setShowGuide(true)}>地图操作</button>
          <details ref={filtersRef} className="graph-more-filters" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)} onKeyDown={event => { if (event.key === 'Escape') setFiltersOpen(false); }}>
            <summary>关系：{relationLabels[relationTypes.find(kind => visible[kind]) || 'family']}</summary>
            <div className="graph-filters" aria-label="图谱关系筛选" role="radiogroup">
              {relationTypes.map(kind => <button key={kind} type="button" role="radio" aria-checked={visible[kind]} aria-pressed={visible[kind]} onClick={() => props.onToggle(kind)}
                className={`filter-chip ${visible[kind] ? 'active' : ''}`} style={{ '--chip': relationColor(kind) } as CSSProperties}>
                <span className={`filter-line relation-${kind}`} aria-hidden="true" />{relationLabels[kind]}</button>)}
              {selected && <button type="button" className={`filter-chip ${showOthers ? 'active' : ''}`} aria-pressed={showOthers} onClick={props.onShowOthers}>
                {showOthers ? '收起关联词' : '显示更多关联词'}
              </button>}
            </div>
          </details>
          {stageId !== 'all' && <button type="button" className="outside-toggle" aria-pressed={showOutside} onClick={props.onShowOutside}>显示阶段外关联词：{showOutside ? '开' : '关'}</button>}
        </div>}
        {(nodes.length > 0 || search) && <div className="graph-search">
          <span aria-hidden="true">⌕</span><input aria-label="搜索图谱单词" placeholder="搜索单词…" value={search} onChange={event => props.onSearch(event.target.value)} />
          {search && <button type="button" onClick={() => props.onSearch('')} aria-label="清除搜索">×</button>}
        </div>}
      </div>
    </div>
    <div className="graph-stage" ref={graphStageRef}>
      {showGuide && nodes.length > 0 && <aside className="graph-onboarding" aria-label="词汇地图使用帮助"><strong>地图怎么用</strong><p>点单词看详情；拖动空白处移动地图；滚动或用工具栏缩放。</p><button type="button" onClick={dismissGuide}>知道了</button></aside>}
      {nodes.length > 0 && <svg className="graph-canvas" viewBox="0 0 1000 700" role="img" aria-label="可拖动的词汇关系图，在地图上滚动可缩放"
        onPointerDown={startCanvas} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onWheel={event => { if (event.deltaY === 0) return; event.preventDefault(); const step = Math.abs(event.deltaY) < 30 ? 5 : 10; changeZoom(clampZoom(zoom + (event.deltaY < 0 ? step : -step))); }}>
        <rect x="0" y="0" width="1000" height="700" fill="transparent" onClick={() => { if (!suppressClick.current) props.onSelect(null); }} />
        <g transform={`translate(${pan.x} ${pan.y}) translate(500 350) scale(${zoom / 100}) translate(-500 -350)`}>
          {families.map(({ familyId: id, nodeIds: members }) => {
            const outlinePoints = members.flatMap(memberId => {
              const node = nodeById[memberId];
              if (!node) return [];
              const center = place(memberId), selectedNode = selected === memberId;
              const radius = nodeRadius(node.lemma, selected, memberId) * (zoom < 75 && !selectedNode ? 0.68 : 1) + 15;
              return Array.from({ length: 20 }, (_, index) => {
                const angle = index * Math.PI * 2 / 20;
                return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
              });
            });
            const outline = familyOutline(outlinePoints);
            if (!outline) return null;
            const center = members.map(place).reduce((sum, item) => ({ x: sum.x + item.x / members.length, y: sum.y + item.y / members.length }), { x: 0, y: 0 });
            return <g key={id} className="family-bubble" data-member-ids={members.join(',')} onClick={event => { event.stopPropagation(); const next = clampZoom(Math.max(125, zoom)); const nextPan = { x: (500 - center.x) * next / 100, y: (350 - center.y) * next / 100 }; panRef.current = nextPan; setPan(nextPan); changeZoom(next); }}>
              <path d={outline} fill={theme.graph.family} fillOpacity="0.045" stroke={theme.graph.family} strokeOpacity="0.62" strokeWidth="2" strokeDasharray="7 6" strokeLinecap="round" strokeLinejoin="round" />
            </g>;
          })}
          {edges.map((edge, index) => {
            const source = place(edge.source), target = place(edge.target);
            let a = source, b = target;
            if (selectedNode && edge.source === selected && edge.sourceSenseId) {
              const i = selectedNode.senseIds.indexOf(edge.sourceSenseId);
              if (i >= 0) a = point(source.x, source.y, 43, (i + 0.5) * 2 * Math.PI / selectedNode.senseIds.length - Math.PI / 2);
            }
            if (selectedNode && edge.target === selected && edge.targetSenseId) {
              const i = selectedNode.senseIds.indexOf(edge.targetSenseId);
              if (i >= 0) b = point(target.x, target.y, 43, (i + 0.5) * 2 * Math.PI / selectedNode.senseIds.length - Math.PI / 2);
            }
            const denseOverview = !selected && nodes.length > 150 && zoom < 75;
            const related = selected && (edge.source === selected || edge.target === selected);
            const pattern = edge.status === 'pending' ? '4 7' : edge.type === 'near_synonym' ? '2 7' : edge.type === 'antonym' ? '12 5' : edge.type === 'spelling_similar' ? '1 6' : undefined;
            const path = curvedEdge(a, b, overviewEdgeOffsets.get(edge) || 0);
            const label = `${nodeById[edge.source]?.lemma} — ${relationLabels[edge.type]}${edge.ruleClassified ? '（按规则分类）' : ''}${edge.status === 'pending' ? '（待核验）' : ''} — ${nodeById[edge.target]?.lemma}`;
            return <g key={`${edge.relationshipId}-${index}`} className="edge-link" tabIndex={0} role="button" aria-label={label}
              onClick={event => { event.stopPropagation(); setEdgeDetails(edge); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setEdgeDetails(edge); } }}>
              <path className={`graph-edge relation-${edge.type} ${selected ? related ? 'is-related' : 'is-dimmed' : ''}`} d={path} fill="none" stroke={relationColor(edge.type)} strokeWidth={related ? 3.5 : 2.4} strokeOpacity={denseOverview ? edge.status === 'pending' ? 0.34 : 0.44 : edge.status === 'pending' ? 0.76 : 0.86} strokeDasharray={pattern} strokeLinecap="round" />
              <path d={path} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" />
              <title>{label}</title>
            </g>;
          })}
          {nodes.map(node => {
            const pos = place(node.wordId), active = selected === node.wordId;
            const radius = nodeRadius(node.lemma, selected, node.wordId);
            const collisionPulse = collisionPulses[node.wordId];
            const activate = () => node.kind === 'entry' ? props.onSelect(node.wordId) : props.onOpenCandidate(node.lemma);
            return <g key={node.wordId} data-node-id={node.wordId} data-node-kind={node.kind} className={`graph-node ${active ? 'is-selected' : ''} ${collisionPulse ? 'is-colliding' : ''} ${node.kind !== 'entry' ? 'is-placeholder' : ''}`} transform={`translate(${pos.x} ${pos.y})`}
              onPointerDown={event => startNode(event, node.wordId)} onClick={event => { event.stopPropagation(); if (!suppressClick.current) activate(); }}
              tabIndex={0} role="button" aria-label={node.lemma}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') activate(); }}>
              {collisionPulse && <circle key={collisionPulse} className="collision-wave" r={radius + 5} onAnimationEnd={() => setCollisionPulses(current => current[node.wordId] === collisionPulse ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== node.wordId)) : current)} />}
              <circle r={zoom < 75 && !active ? radius * .68 : radius} fill={node.kind === 'entry' ? colorOf(node) : node.outsideStage ? theme.graph.nodes.outside : theme.graph.nodes.candidate} fillOpacity={node.kind === 'entry' ? 1 : 0.82} stroke={active ? theme.controls.focus : node.kind === 'entry' && familyCenters.has(node.wordId) ? theme.graph.family : theme.ui.border} strokeWidth={active ? 3.5 : node.kind === 'entry' && familyCenters.has(node.wordId) ? 2.5 : 1.25} />
              {(zoom >= 75 || active) && <text className={node.kind === 'entry' && familyCenters.has(node.wordId) ? 'graph-family-center-label' : undefined} y="5" textAnchor="middle" fontSize={active ? 16 : 14} fontWeight={node.kind === 'entry' && familyCenters.has(node.wordId) ? 400 : 600} fill={node.kind === 'entry' && familyCenters.has(node.wordId) ? theme.ui.surface : theme.ui.text}>{node.lemma}</text>}
              <title>{node.lemma}</title>
            </g>;
          })}
        </g>
      </svg>}
      {data && nodes.length === 0 && <div className="graph-empty"><FieldGuideArt /><strong>选一份词表，开始探索</strong><button type="button" className="primary-button" onClick={props.onOpenProjects}>选词表 →</button></div>}
      {!data && <div className="graph-empty" role="status">正在打开地图…</div>}
      {edgeDetails && <div className="edge-details"><button type="button" onClick={() => setEdgeDetails(null)} aria-label="关闭关系详情">×</button><strong>{nodeById[edgeDetails.source]?.lemma} ↔ {nodeById[edgeDetails.target]?.lemma}</strong><span>{relationLabels[edgeDetails.type]}{edgeDetails.ruleClassified ? ' · 按规则分类' : ''}</span>
        {edgeDetails.relations.map((relation, index) => {
          const targetWordId = relation.sourceWordId === edgeDetails.source ? edgeDetails.target : edgeDetails.source;
          return <small key={`${relation.relationshipId}-${index}`}>{relation.sourceSenseId ?
            `${nodeById[relation.sourceWordId]?.lemma}：${senseLabel(relation.sourceWordId, relation.sourceSenseId)} → ${nodeById[targetWordId]?.lemma}：${senseLabel(targetWordId, relation.targetSenseId)}` : '词条级关系'}</small>;
        })}
      </div>}
      {nodes.length > 0 && <div ref={toolsIslandRef} className={`graph-tools-island ${toolPosition ? 'is-positioned' : ''}`} style={toolPosition ? { '--tool-x': `${toolPosition.x * 100}%`, '--tool-y': `${toolPosition.y * 100}%` } as CSSProperties : undefined} role="group" aria-label="地图工具">
      <button type="button" className="graph-tools-drag" aria-label="拖动地图工具栏，可用方向键移动" title="拖动工具栏；方向键也可移动" onPointerDown={startToolDrag} onPointerMove={moveToolDrag} onPointerUp={finishToolDrag} onPointerCancel={finishToolDrag} onLostPointerCapture={finishToolDrag} onKeyDown={moveToolWithKeyboard}><GripVertical size={18} aria-hidden="true" /></button>
      {!selected && props.groupCount > 1 && <div className="graph-group-navigation" aria-label="词表分组">
        <button type="button" aria-label="上一组" disabled={props.groupIndex === 0} onClick={() => props.onGroupChange(props.groupIndex - 1)}>‹</button>
        <select aria-label="图谱分组" value={props.groupIndex} onChange={event => props.onGroupChange(Number(event.target.value))}>{Array.from({ length: props.groupCount }, (_, index) => <option key={index} value={index}>第 {index + 1} 组</option>)}</select>
        <button type="button" aria-label="下一组" disabled={props.groupIndex + 1 >= props.groupCount} onClick={() => props.onGroupChange(props.groupIndex + 1)}>›</button>
      </div>}<div className="zoom-controls">
        <select aria-label="常用缩放比例" value={[25, 50, 75, 100, 125, 150, 200].includes(zoom) ? zoom : ''} onChange={event => changeZoom(Number(event.target.value))}>
          <option value="" disabled>{zoom}%</option>{[25, 50, 75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}
        </select>
        <button type="button" disabled={zoom <= 25} onClick={() => changeZoom(zoom - 10)} aria-label="缩小">−</button>
        <button type="button" disabled={zoom >= 400} onClick={() => changeZoom(zoom + 10)} aria-label="放大">+</button>
      </div></div>}
    </div>
  </section>;
}
