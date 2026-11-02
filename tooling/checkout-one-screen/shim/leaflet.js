// leaflet stand-in for the one-screen harness ONLY (the map editor is not on the Checkout page). Never shipped.
const chain = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : chain), apply: () => chain });
export default chain;
