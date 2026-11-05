// cardpointe-mock-server.mjs — a tiny server that speaks the CardPointe Gateway REST contract, for end-to-end testing of
// the real CardPointeClient code path WITHOUT a live Fiserv MID. It is NOT the real processor; it just returns
// CardConnect-shaped responses. Approves by default; declines when the account is the canonical decline PAN.
import http from 'node:http';

const DECLINE_ACCOUNT = '4000000000000002';
let n = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = req.url || '';
    const hasBasic = String(req.headers['authorization'] || '').startsWith('Basic ');
    let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    n += 1;
    if (!hasBasic) { res.writeHead(401); return res.end('missing basic auth'); }
    if (req.method === 'PUT' && url.endsWith('/cardconnect/rest/auth')) {
      if (body.account === DECLINE_ACCOUNT) return send({ respstat: 'C', retref: 'MOCK-DECL-' + n, resptext: 'Declined', amount: body.amount });
      return send({ respstat: 'A', retref: 'MOCK-AUTH-' + n, authcode: 'MOCKOK' + n, amount: body.amount, resptext: 'Approval', token: '9999888877776666' });
    }
    if (req.method === 'PUT' && url.endsWith('/cardconnect/rest/refund')) return send({ respstat: 'A', retref: 'MOCK-RFND-' + n, resptext: 'Approval', amount: body.amount });
    if (req.method === 'PUT' && url.endsWith('/cardconnect/rest/void')) return send({ respstat: 'A', retref: 'MOCK-VOID-' + n, resptext: 'Approval' });
    res.writeHead(404); res.end('not found');
  });
});
const port = Number(process.env.MOCK_PORT || 4599);
server.listen(port, '127.0.0.1', () => console.log('cardpointe-mock listening on ' + port));
