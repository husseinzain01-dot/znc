const B = 'http://localhost:4810'; const jar = {};
async function call(who, method, url, body) {
  const h = {}; if (jar[who]) h.Cookie = jar[who]; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(B + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  let j = {}; try { j = await r.json(); } catch (_) {} return { status: r.status, ...j };
}
const ok = (l, c) => console.log((c ? 'PASS ' : 'FAIL ') + l);
const boot = u => call(u, 'GET', '/api/bootstrap');
const items = [{ name: 'صنف', qty: 1, price: 1000 }], just = 'مبرر كافٍ للطلب هنا';
await call('x', 'POST', '/api/db-config', { server: 'localhost', port: 1433, database: 'PurchaseRequestsDB', user: 'sa', password: process.env.MSSQL_SA_PASSWORD || 'Test_Pass123!', trustCert: true });
await call('owner', 'POST', '/api/setup', { company: 'شركة', name: 'حسين', username: 'owner', password: 'secret12' });
const mk = (n, u, dep, role = 'user') => call('owner', 'POST', '/api/users', { name: n, username: u, password: 'secret12', role, department: dep });
let r = await call('owner', 'POST', '/api/users', { name: 'بلا قسم', username: 'nodep', password: 'secret12', role: 'user' });
ok('user without department rejected: ' + r.error, r.status === 400);
const P = [['طالب الإنتاج', 'reqa', 'الإنتاج'], ['مدير الإنتاج', 'mgra', 'الإنتاج'], ['طالب المالية', 'reqb', 'المالية'], ['مدير المالية', 'mgrb', 'المالية'], ['طالب الصيانة', 'reqc', 'الصيانة'], ['المدير العام', 'gm', 'الإدارة', 'admin'], ['مدقق عام', 'gen', 'الإدارة']];
for (const p of P) await mk(...p);
for (const [, u] of P) await call(u, 'POST', '/api/login', { username: u, password: 'secret12' });
const ids = Object.fromEntries((await boot('owner')).users.map(u => [u.username, u.id]));
const st = (t, a) => ({ title: t, approvers: [ids[a]], minAmount: 0 });
r = await call('owner', 'PUT', '/api/settings', {
  chain: [st('المدقق العام', 'gen'), st('المدير العام', 'gm')],
  chains: { 'الإنتاج': [st('مدير الإنتاج', 'mgra'), st('المدير العام', 'gm')], 'المالية': [st('مدير المالية', 'mgrb')] },
  buyers: [], usdRate: 1310,
});
ok('owner saves general + 2 department chains', r.ok);
r = await call('owner', 'PUT', '/api/settings', { chain: [st('x', 'gen')], chains: { 'الإنتاج': [{ title: 'بدون معتمد', approvers: [], minAmount: 0 }] } });
ok('department chain without approver rejected: ' + r.error, r.status === 400);
r = await call('gm', 'PUT', '/api/settings', { chain: [st('x', 'gen')] }); ok('GM cannot change chains', r.status === 403);

const sub = async (u, extra = {}) => { const x = await call(u, 'POST', '/api/requests', { title: 'طلب ' + u, items, justification: just, submit: true, ...extra }); return (await boot(u)).requests.find(q => q.id === x.id); };
const ra = await sub('reqa', { department: 'المالية' });
ok('production request uses production chain: ' + ra.chain.map(s => s.title).join(' ← '), ra.chain[0].approvers[0] === ids.mgra && ra.chain.length === 2);
ok('department forced to requester department (sent المالية, got ' + ra.department + ')', ra.department === 'الإنتاج');
const rb = await sub('reqb');
ok('finance request uses finance chain: ' + rb.chain.map(s => s.title).join(' ← '), rb.chain.length === 1 && rb.chain[0].approvers[0] === ids.mgrb);
const rc = await sub('reqc');
ok('maintenance (no own chain) uses general chain: ' + rc.chain.map(s => s.title).join(' ← '), rc.chain[0].approvers[0] === ids.gen);
const vis = async u => (await boot(u)).requests.map(q => q.no).sort().join(',') || '-';
ok('mgra sees only production request: ' + await vis('mgra'), await vis('mgra') === ra.no);
ok('mgrb sees only finance request: ' + await vis('mgrb'), await vis('mgrb') === rb.no);
ok('gen sees only maintenance request: ' + await vis('gen'), await vis('gen') === rc.no);
ok('gm sees nothing yet: ' + await vis('gm'), await vis('gm') === '-');
await call('mgra', 'POST', `/api/requests/${ra.id}/decision`, { decision: 'approved' });
ok('after mgra: gm sees production request', (await vis('gm')).includes(ra.no));
await call('mgrb', 'POST', `/api/requests/${rb.id}/decision`, { decision: 'approved' });
ok('finance single-stage chain fully approved', (await boot('reqb')).requests[0].status === 'approved');

// admin submits a draft created by someone else -> creator's department chain
const draft = await call('reqb', 'POST', '/api/requests', { title: 'مسودة', items, justification: just });
const dr = (await boot('reqb')).requests.find(q => q.id === draft.id);
r = await call('owner', 'PUT', `/api/requests/${draft.id}`, { ...dr, submit: true });
ok('others cannot touch a private draft (' + r.status + ')', r.status === 404);

r = await call('owner', 'PUT', '/api/lists', { departments: ['الإدارة', 'الإنتاج', 'الصيانة'] });
ok('cannot delete department with users: ' + r.error, r.status === 400);
r = await call('owner', 'PUT', `/api/users/${ids.mgra}`, { active: false });
ok('cannot deactivate a department-chain approver: ' + r.error, r.status === 400);
// moving a user to another department changes the chain for new requests
await call('owner', 'PUT', `/api/users/${ids.reqc}`, { department: 'الإنتاج' });
const rc2 = await sub('reqc');
ok('after moving reqc to production, new request uses production chain', rc2.chain[0].approvers[0] === ids.mgra);
