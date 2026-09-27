/** Minimal pub/sub used to keep systems decoupled. */
export class EventBus {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.map.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const set = this.map.get(type);
    if (set) for (const fn of set) fn(payload);
  }
}
