// Accumulates quads / boxes / arbitrary geometries into ONE BufferGeometry
// (positions, normals, uvs, vertex colours). This is how whole city blocks end
// up as a handful of draw calls.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _c = new THREE.Color();

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.extra = null; // optional per-vertex extra attributes (skinning)
    this.matrix = new THREE.Matrix4();
    this.normalMatrix = new THREE.Matrix3();
    this.identity = true;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  setTransform(m) {
    if (!m) {
      this.matrix.identity();
      this.identity = true;
    } else {
      this.matrix.copy(m);
      this.identity = false;
    }
    this.normalMatrix.getNormalMatrix(this.matrix);
    return this;
  }

  /** Convenience: translation + rotation about Y. */
  place(x, y, z, rotY = 0, scale = 1) {
    const m = new THREE.Matrix4().makeRotationY(rotY);
    if (scale !== 1) m.scale(new THREE.Vector3(scale, scale, scale));
    m.setPosition(x, y, z);
    return this.setTransform(m);
  }

  _push(x, y, z, nx, ny, nz, u, v, color) {
    _v.set(x, y, z);
    _n.set(nx, ny, nz);
    if (!this.identity) {
      _v.applyMatrix4(this.matrix);
      _n.applyMatrix3(this.normalMatrix).normalize();
    }
    this.pos.push(_v.x, _v.y, _v.z);
    this.nor.push(_n.x, _n.y, _n.z);
    this.uv.push(u, v);
    this.col.push(color.r, color.g, color.b);
    if (this.extra) this.extra.onVertex(this);
  }

  /**
   * Quad from 4 corners (counter-clockwise when looking at the front face):
   * p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left.
   * uv = [u0, v0, u1, v1]
   */
  quad(p0, p1, p2, p3, color, uv = [0, 0, 1, 1]) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = this.vertexCount;
    const c = color.isColor ? color : _c.set(color);
    this._push(p0[0], p0[1], p0[2], nx, ny, nz, uv[0], uv[1], c);
    this._push(p1[0], p1[1], p1[2], nx, ny, nz, uv[2], uv[1], c);
    this._push(p2[0], p2[1], p2[2], nx, ny, nz, uv[2], uv[3], c);
    this._push(p3[0], p3[1], p3[2], nx, ny, nz, uv[0], uv[3], c);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(p0, p1, p2, color, uv = [0, 0, 1, 1]) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const base = this.vertexCount;
    const c = color.isColor ? color : _c.set(color);
    this._push(p0[0], p0[1], p0[2], nx / l, ny / l, nz / l, uv[0], uv[1], c);
    this._push(p1[0], p1[1], p1[2], nx / l, ny / l, nz / l, uv[2], uv[1], c);
    this._push(p2[0], p2[1], p2[2], nx / l, ny / l, nz / l, (uv[0] + uv[2]) / 2, uv[3], c);
    this.idx.push(base, base + 1, base + 2);
  }

  /** Axis-aligned (in current transform) box centred at (cx,cy,cz). faces: skip flags. */
  box(cx, cy, cz, sx, sy, sz, color, uv = [0, 0, 1, 1], skip = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    if (!skip.front) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, uv);
    if (!skip.back) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, uv);
    if (!skip.right) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, uv);
    if (!skip.left) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, uv);
    if (!skip.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color, uv);
    if (!skip.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, uv);
  }

  /** Append an existing (indexed or not) BufferGeometry with local matrix + colour. */
  geometry(geom, matrix, color, uvOverride = null) {
    const saved = this.matrix.clone();
    const savedId = this.identity;
    if (matrix) {
      const m = savedId ? matrix.clone() : saved.clone().multiply(matrix);
      this.setTransform(m);
    }
    const p = geom.attributes.position;
    const n = geom.attributes.normal;
    const uv = geom.attributes.uv;
    const col = geom.attributes.color;
    const base = this.vertexCount;
    const c = color ? (color.isColor ? color.clone() : new THREE.Color(color)) : new THREE.Color(1, 1, 1);
    const vc = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let cc = c;
      if (col) {
        vc.setRGB(col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
        cc = vc;
      }
      this._push(
        p.getX(i), p.getY(i), p.getZ(i),
        n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0,
        uvOverride ? uvOverride[0] : uv ? uv.getX(i) : 0,
        uvOverride ? uvOverride[1] : uv ? uv.getY(i) : 0,
        cc,
      );
    }
    if (geom.index) {
      const ix = geom.index.array;
      for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    this.matrix.copy(saved);
    this.identity = savedId;
    this.normalMatrix.getNormalMatrix(this.matrix);
  }

  build() {
    const g = new THREE.BufferGeometry();
    if (!this.pos.length) return g;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const count = this.vertexCount;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (this.extra) this.extra.finish(g);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const color = (hex) => new THREE.Color(hex);
