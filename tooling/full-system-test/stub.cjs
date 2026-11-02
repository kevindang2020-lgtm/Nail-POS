module.exports = new Proxy({}, { get: (_, k) => (k === '__esModule' ? false : function stub() { return stub; }) });
