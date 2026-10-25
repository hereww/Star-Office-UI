/** Ground-plane navigation. Only orthogonal segments; no diagonal fallback or teleport. */
export const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
export const FOOT_RADIUS = 18;
export const GRID_STEP = 16;
export function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function intersectsCircle([x, y], [rx, ry, rw, rh], radius) {
  const dx = x - Math.max(rx, Math.min(x, rx + rw));
  const dy = y - Math.max(ry, Math.min(y, ry + rh));
  return dx * dx + dy * dy < radius * radius;
}
export function stationFootprint({ center: [x, y] }) {
  // Approved 192px furniture alpha: chair 55..138/43..151, desk 12..181/72..169.
  return [x - 84, y - 53, 169, 127];
}
export function stationDock(station) { return [station.center[0], station.center[1] - 88]; }
export function directionBetween(a, b) {
  if (a[0] !== b[0] && a[1] !== b[1]) throw new Error('斜向路径禁止');
  if (a[0] !== b[0]) return b[0] > a[0] ? 'right' : 'left';
  if (a[1] !== b[1]) return b[1] > a[1] ? 'down' : 'up';
  return null;
}
function wallRect([x1, y1, x2, y2]) {
  const pad = 18;
  return [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.abs(x2 - x1) + 2 * pad, Math.abs(y2 - y1) + 2 * pad];
}
class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items; let i = a.length; a.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].score <= item.score) break; a[i] = a[p]; i = p; }
    a[i] = item;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1].score < a[child].score) child++;
        if (last.score <= a[child].score) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
}
export class OfficeNavigator {
  constructor(layout, extras = [], { radius = FOOT_RADIUS, step = GRID_STEP } = {}) {
    this.layout = layout; this.radius = radius; this.step = step;
    this.cols = Math.ceil(layout.size[0] / step) + 1; this.rows = Math.ceil(layout.size[1] / step) + 1;
    this.obstacles = [
      ...layout.walls.map((wall, i) => ({ id: `wall-${i}`, bounds: wallRect(wall) })),
      ...layout.stations.map(station => ({ id: station.id, bounds: stationFootprint(station) })),
      ...extras
    ];
    this.grid = new Uint8Array(this.cols * this.rows);
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) this.grid[y * this.cols + x] = this.isWalkable([x * step, y * step]) ? 1 : 0;
  }
  isWalkable(point) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return false;
    const [x, y] = point, r = this.radius;
    // The whole ground footprint must be inside the office, not just the center.
    for (const [dx, dy] of [[0, 0], [-r, 0], [r, 0], [0, -r], [0, r], [-r * .71, -r * .71], [r * .71, -r * .71], [-r * .71, r * .71], [r * .71, r * .71]]) {
      if (!pointInPolygon([x + dx, y + dy], this.layout.outline)) return false;
    }
    return !this.obstacles.some(({ bounds }) => intersectsCircle(point, bounds, r));
  }
  segmentClear(a, b) {
    directionBetween(a, b);
    const length = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), steps = Math.max(1, Math.ceil(length / 4));
    for (let i = 0; i <= steps; i++) if (!this.isWalkable([a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps])) return false;
    return true;
  }
  nearest(point, maxDistance = 40) {
    if (!point.every(Number.isFinite)) return null;
    const [gx, gy] = point.map(v => Math.round(v / this.step)), range = Math.ceil(maxDistance / this.step);
    let closest = null, distance = Infinity;
    for (let y = Math.max(0, gy - range); y <= Math.min(this.rows - 1, gy + range); y++) {
      for (let x = Math.max(0, gx - range); x <= Math.min(this.cols - 1, gx + range); x++) {
        const node = y * this.cols + x;
        if (!this.grid[node]) continue;
        const d = Math.hypot(x * this.step - point[0], y * this.step - point[1]);
        if (d <= maxDistance && d < distance) { distance = d; closest = [x * this.step, y * this.step]; }
      }
    }
    return closest;
  }
  route(start, goal) {
    if (!this.isWalkable(start) || !this.isWalkable(goal)) return null;
    const source = this.nearest(start), target = this.nearest(goal);
    if (!source || !target) return null;
    const a = source[1] / this.step * this.cols + source[0] / this.step;
    const b = target[1] / this.step * this.cols + target[0] / this.step;
    const count = this.grid.length, distance = new Float64Array(count).fill(Infinity), previous = new Int32Array(count).fill(-1), closed = new Uint8Array(count);
    const heap = new MinHeap(), heuristic = id => Math.abs(id % this.cols - b % this.cols) + Math.abs(Math.floor(id / this.cols) - Math.floor(b / this.cols));
    distance[a] = 0; heap.push({ id: a, score: heuristic(a) });
    while (heap.items.length) {
      const { id } = heap.pop(); if (closed[id]) continue; closed[id] = 1;
      if (id === b) {
        const nodes = []; let current = b;
        do { nodes.push([current % this.cols * this.step, Math.floor(current / this.cols) * this.step]); current = previous[current]; } while (current !== -1);
        nodes.reverse(); const path = [nodes[0]];
        for (let i = 1; i < nodes.length - 1; i++) if (directionBetween(nodes[i - 1], nodes[i]) !== directionBetween(nodes[i], nodes[i + 1])) path.push(nodes[i]);
        if (nodes.length > 1) path.push(nodes.at(-1));
        // Keep off-grid current position: prepend an orthogonal bridge, never teleport to a grid point.
        const bridge = this.bridge(start, source);
        if (!bridge) return null;
        return [...bridge.slice(0, -1), ...path];
      }
      const x = id % this.cols, y = Math.floor(id / this.cols);
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const next = ny * this.cols + nx;
        if (!this.grid[next] || closed[next] || distance[id] + 1 >= distance[next]) continue;
        const from = [x * this.step, y * this.step], to = [nx * this.step, ny * this.step];
        if (!this.segmentClear(from, to)) continue;
        previous[next] = id; distance[next] = distance[id] + 1;
        heap.push({ id: next, score: distance[next] + heuristic(next) });
      }
    }
    return null;
  }
  bridge(a, b) {
    if (a[0] === b[0] && a[1] === b[1]) return [a];
    if (a[0] === b[0] || a[1] === b[1]) return this.segmentClear(a, b) ? [a, b] : null;
    for (const elbow of [[a[0], b[1]], [b[0], a[1]]]) if (this.segmentClear(a, elbow) && this.segmentClear(elbow, b)) return [a, elbow, b];
    return null;
  }
  dock(station) { return this.nearest(stationDock(station), 40); }
}
export function moveAlong(position, path, budget) {
  let point = [...position], remaining = path.map(p => [...p]), traveled = 0, direction = null;
  while (remaining.length && budget > 0) {
    const goal = remaining[0], length = Math.abs(point[0] - goal[0]) + Math.abs(point[1] - goal[1]);
    if (length < 1e-7) { remaining.shift(); continue; }
    direction = directionBetween(point, goal);
    const amount = Math.min(length, budget), axis = point[0] === goal[0] ? 1 : 0;
    point[axis] += Math.sign(goal[axis] - point[axis]) * amount;
    budget -= amount; traveled += amount;
    if (amount === length) { point = [...goal]; remaining.shift(); }
  }
  return { position: point, path: remaining, traveled, direction };
}
