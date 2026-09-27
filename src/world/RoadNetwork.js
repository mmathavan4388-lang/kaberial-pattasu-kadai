// Road graph + spatial queries + lane geometry used by traffic, pedestrians,
// police pathfinding, building placement and rendering. No three.js dependency.
import { ROAD_NODES, ROAD_EDGES, RAILWAY } from './MapData.js';
import { distToSegment } from '../core/utils.js';

const CELL = 100;

export class RoadNetwork {
  constructor() {
    this.nodes = new Map();
    for (const n of ROAD_NODES) this.nodes.set(n.id, { ...n, edges: [], radius: 0 });
    this.edges = ROAD_EDGES.map((e, i) => {
      const a = this.nodes.get(e.a);
      const b = this.nodes.get(e.b);
      if (!a || !b) throw new Error(`Bad road edge ${e.a}-${e.b}`);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const edge = {
        i, a, b, w: e.w, hw: e.w / 2, type: e.type, len,
        dx: dx / len, dz: dz / len,
        lane: e.w >= 10 ? e.w * 0.26 : e.w * 0.25,
      };
      a.edges.push(edge);
      b.edges.push(edge);
      return edge;
    });
    for (const n of this.nodes.values()) {
      n.radius = n.edges.reduce((m, e) => Math.max(m, e.hw), 0);
    }
    this.grid = new Map();
    this.edges.forEach((e) => this.rasterize(e));
    this.rail = [];
    for (let i = 0; i < RAILWAY.length - 1; i++) {
      const [ax, az] = RAILWAY[i];
      const [bx, bz] = RAILWAY[i + 1];
      this.rail.push({ ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az) });
    }
    this.railLength = this.rail.reduce((s, r) => s + r.len, 0);
  }

  cellKey(cx, cz) {
    return cx * 10007 + cz;
  }

  rasterize(e) {
    const steps = Math.ceil(e.len / 20) + 1;
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = e.a.x + (e.b.x - e.a.x) * t;
      const z = e.a.z + (e.b.z - e.a.z) * t;
      const cx0 = Math.floor((x - e.hw - 30) / CELL);
      const cx1 = Math.floor((x + e.hw + 30) / CELL);
      const cz0 = Math.floor((z - e.hw - 30) / CELL);
      const cz1 = Math.floor((z + e.hw + 30) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const k = this.cellKey(cx, cz);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(e);
        }
      }
    }
  }

  edgesNear(x, z) {
    return this.grid.get(this.cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
  }

  /** Nearest road edge to (x,z) (within ~30 m of cell padding), or null. */
  nearest(x, z) {
    let best = null;
    for (const e of this.edgesNear(x, z)) {
      const r = distToSegment(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
      if (!best || r.d < best.d) best = { edge: e, d: r.d, t: r.t, x: r.x, z: r.z };
    }
    return best;
  }

  /** Signed clearance from the road surface: < 0 means standing on a road. */
  roadClearance(x, z) {
    let m = Infinity;
    for (const e of this.edgesNear(x, z)) {
      const r = distToSegment(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
      m = Math.min(m, r.d - e.hw);
    }
    return m;
  }

  /** Global slow path (for far-away checks). */
  roadClearanceGlobal(x, z) {
    let m = Infinity;
    for (const e of this.edges) {
      const r = distToSegment(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
      m = Math.min(m, r.d - e.hw);
    }
    return m;
  }

  railDistance(x, z) {
    let m = Infinity;
    for (const r of this.rail) m = Math.min(m, distToSegment(x, z, r.ax, r.az, r.bx, r.bz).d);
    return m;
  }

  /** Point + tangent along the railway at distance s from the north end. */
  railPoint(s) {
    s = Math.max(0, Math.min(this.railLength, s));
    for (const r of this.rail) {
      if (s <= r.len) {
        const t = s / r.len;
        return { x: r.ax + (r.bx - r.ax) * t, z: r.az + (r.bz - r.az) * t, dx: (r.bx - r.ax) / r.len, dz: (r.bz - r.az) / r.len };
      }
      s -= r.len;
    }
    const r = this.rail[this.rail.length - 1];
    return { x: r.bx, z: r.bz, dx: (r.bx - r.ax) / r.len, dz: (r.bz - r.az) / r.len };
  }

  /** Railway arc-length of the point closest to z (used for placing stations). */
  railParamAtZ(z) {
    let acc = 0;
    for (const r of this.rail) {
      const lo = Math.min(r.az, r.bz);
      const hi = Math.max(r.az, r.bz);
      if (z >= lo && z <= hi) return acc + ((z - r.az) / (r.bz - r.az)) * r.len;
      acc += r.len;
    }
    return 0;
  }

  nearestNode(x, z) {
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  other(edge, node) {
    return edge.a === node ? edge.b : edge.a;
  }

  // ------------------------------------------------------------ lanes
  /** Straight lane segment along edge in direction dir (+1 a→b, -1 b→a). Left-hand traffic. */
  laneSegment(edge, dir, offset = edge.lane) {
    const from = dir > 0 ? edge.a : edge.b;
    const to = dir > 0 ? edge.b : edge.a;
    const fx = edge.dx * dir;
    const fz = edge.dz * dir;
    const lx = fz;
    const lz = -fx;
    const t0 = from.edges.length > 1 ? from.radius + 2 : 0;
    const t1 = to.edges.length > 1 ? to.radius + 2 : 0;
    const x0 = from.x + fx * t0 + lx * offset;
    const z0 = from.z + fz * t0 + lz * offset;
    const x1 = to.x - fx * t1 + lx * offset;
    const z1 = to.z - fz * t1 + lz * offset;
    return { kind: 'line', edge, dir, from, to, x0, z0, x1, z1, fx, fz, len: Math.max(0.5, edge.len - t0 - t1) };
  }

  /** Smooth quadratic bezier across a junction between two lane segments. */
  connector(a, b) {
    const p0x = a.x1, p0z = a.z1, p2x = b.x0, p2z = b.z0;
    let cx = (p0x + p2x) / 2;
    let cz = (p0z + p2z) / 2;
    const den = a.fx * b.fz - a.fz * b.fx;
    if (Math.abs(den) > 0.05) {
      const t = ((p2x - p0x) * b.fz - (p2z - p0z) * b.fx) / den;
      if (t > 0 && t < 40) { cx = p0x + a.fx * t; cz = p0z + a.fz * t; }
    } else if (a.fx * b.fx + a.fz * b.fz < 0) {
      // U-turn at a dead end: swing wide around the node
      cx = a.to.x + a.fx * 6;
      cz = a.to.z + a.fz * 6;
    }
    const seg = { kind: 'bez', p0x, p0z, cx, cz, p2x, p2z, len: 0 };
    let len = 0;
    let px = p0x, pz = p0z;
    for (let i = 1; i <= 8; i++) {
      const p = this.pointOn(seg, i / 8, true);
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x; pz = p.z;
    }
    seg.len = Math.max(0.5, len);
    return seg;
  }

  /** Point + tangent at distance s (or normalized t when isT) on a lane / connector segment. */
  pointOn(seg, s, isT = false) {
    const t = isT ? s : Math.max(0, Math.min(1, s / seg.len));
    if (seg.kind === 'line') {
      return { x: seg.x0 + (seg.x1 - seg.x0) * t, z: seg.z0 + (seg.z1 - seg.z0) * t, hx: seg.fx, hz: seg.fz };
    }
    const u = 1 - t;
    const x = u * u * seg.p0x + 2 * u * t * seg.cx + t * t * seg.p2x;
    const z = u * u * seg.p0z + 2 * u * t * seg.cz + t * t * seg.p2z;
    let hx = 2 * u * (seg.cx - seg.p0x) + 2 * t * (seg.p2x - seg.cx);
    let hz = 2 * u * (seg.cz - seg.p0z) + 2 * t * (seg.p2z - seg.cz);
    const l = Math.hypot(hx, hz) || 1;
    return { x, z, hx: hx / l, hz: hz / l };
  }

  /** Pick the next edge at a node, avoiding U-turns when possible. Bias to bigger roads. */
  chooseNext(node, fromEdge, rng) {
    const options = node.edges.filter((e) => e !== fromEdge);
    if (!options.length) return fromEdge;
    let total = 0;
    const w = options.map((e) => {
      const v = e.type === 'highway' || e.type === 'main' ? 2 : 1;
      total += v;
      return v;
    });
    let r = rng() * total;
    for (let i = 0; i < options.length; i++) {
      r -= w[i];
      if (r <= 0) return options[i];
    }
    return options[0];
  }

  dirFrom(edge, node) {
    return edge.a === node ? 1 : -1;
  }

  /** A* over the road graph. Returns array of nodes. */
  astar(start, goal) {
    if (start === goal) return [start];
    const open = new Set([start]);
    const came = new Map();
    const g = new Map([[start, 0]]);
    const f = new Map([[start, Math.hypot(start.x - goal.x, start.z - goal.z)]]);
    while (open.size) {
      let cur = null;
      let best = Infinity;
      for (const n of open) {
        const v = f.get(n);
        if (v < best) { best = v; cur = n; }
      }
      if (cur === goal) {
        const path = [cur];
        while (came.has(cur)) { cur = came.get(cur); path.unshift(cur); }
        return path;
      }
      open.delete(cur);
      for (const e of cur.edges) {
        const nb = this.other(e, cur);
        const tg = g.get(cur) + e.len;
        if (tg < (g.get(nb) ?? Infinity)) {
          came.set(nb, cur);
          g.set(nb, tg);
          f.set(nb, tg + Math.hypot(nb.x - goal.x, nb.z - goal.z));
          open.add(nb);
        }
      }
    }
    return null;
  }
}
