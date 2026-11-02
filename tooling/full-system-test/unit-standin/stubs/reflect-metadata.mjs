const store = new WeakMap();
const bag = (t) => { let m = store.get(t); if (!m) { m = new Map(); store.set(t, m); } return m; };
Reflect.defineMetadata ??= (k, v, t) => { bag(t).set(k, v); };
Reflect.getMetadata ??= (k, t) => { for (let o = t; o; o = Object.getPrototypeOf(o)) { const m = store.get(o); if (m?.has(k)) return m.get(k); } };
Reflect.getOwnMetadata ??= (k, t) => store.get(t)?.get(k);
Reflect.hasMetadata ??= (k, t) => Reflect.getMetadata(k, t) !== undefined;
Reflect.metadata ??= (k, v) => (t, p) => Reflect.defineMetadata(k, v, p ? t[p] : t);
export default {};
