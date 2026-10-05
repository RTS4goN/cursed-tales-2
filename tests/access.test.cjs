const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const {parseAccess, decryptCatalog} = require('../access.js');
function encrypt(data, key, tier = data.tier) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);
  cipher.setAAD(Buffer.from('cursed-tales-2:' + tier));
  return Buffer.concat([iv, cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]);
}
const keys = Object.fromEntries(['core', 'full', 'complete'].map(t => [t, crypto.randomBytes(32).toString('base64url')]));
for (const tier of Object.keys(keys)) {
  const catalog = {tier, items: [], access: {nsfw: tier !== 'core'}}, encrypted = encrypt(catalog, keys[tier]);
  test(tier + ': own key opens catalog', async () => {
    assert.deepEqual(await decryptCatalog(encrypted, parseAccess('#access=' + tier + '.' + keys[tier])), catalog);
  });
  for (const other of Object.keys(keys).filter(t => t !== tier)) test(tier + ': cannot open ' + other, async () => {
    await assert.rejects(decryptCatalog(encrypt({tier: other, items: [], access: {}}, keys[other]), {tier: other, key: keys[tier]}));
  });
  test(tier + ': altered payload fails closed', async () => {
    const tampered = Buffer.from(encrypted); tampered[20] ^= 1;
    await assert.rejects(decryptCatalog(tampered, {tier, key: keys[tier]}));
  });
}
test('Malformed links do not grant access', () => {
  for (const hash of ['', '#core', '#access=core', '#access=admin.' + keys.core, '#access=complete.fake',
    '#access=core.' + keys.core + '&tier=complete', '#access=core.' + keys.core + '.']) assert.equal(parseAccess(hash), null);
});
test('Payload cannot claim another tier', async () => {
  await assert.rejects(decryptCatalog(encrypt({tier: 'complete', items: [], access: {}}, keys.core, 'core'), {tier: 'core', key: keys.core}));
});
test('Root is locked with no downloads or legacy catalog loader', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), doc = dom.window.document;
  assert.ok(doc.querySelector('#collection').hidden && doc.querySelector('.all-panel').hidden);
  assert.ok(doc.querySelector('#access-gate'));
  assert.ok(!doc.querySelector('script[src^="catalog.js"]'));
  assert.ok(!doc.querySelector('a[href*="drive.google"],a[href*="drive.usercontent"]'));
  assert.equal(doc.querySelector('meta[name="robots"]').content, 'noindex,nofollow');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'catalog.js'), 'utf8'), /https:\/\//);
  dom.window.close();
});
async function openPage(hash, fetcher) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    runScripts: 'outside-only', url: 'https://rts4gon.github.io/cursed-tales-2/' + hash
  });
  const w = dom.window;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  Object.defineProperty(w, 'crypto', {value: crypto.webcrypto});
  w.fetch = fetcher;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  w.HTMLDialogElement.prototype.close = function () {this.open = false;};
  const append = w.document.head.append.bind(w.document.head);
  w.document.head.append = (...nodes) => {
    append(...nodes);
    for (const node of nodes) if (node.tagName === 'SCRIPT' && node.src.includes('/app.js')) {
      w.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
      queueMicrotask(() => node.dispatchEvent(new w.Event('load')));
    }
  };
  w.eval(fs.readFileSync(path.join(root, 'campaign.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'access.js'), 'utf8'));
  for (let n = 0; n < 500 && !['ready', 'locked', 'error'].includes(w.document.body.dataset.accessState); n++)
    await new Promise(resolve => setTimeout(resolve, 5));
  return dom;
}
test('No key: no catalog request and no downloads', async () => {
  const dom = await openPage('', () => {throw new Error('Unexpected fetch');});
  assert.equal(dom.window.document.body.dataset.accessState, 'locked');
  assert.equal(dom.window.document.querySelector('#cards').children.length, 0); dom.window.close();
});
test('Invalid key: locked UI and retry', async () => {
  const dom = await openPage('#access=core.' + keys.full, async () => ({ok: true,
    arrayBuffer: async () => encrypt({tier: 'core', items: [], access: {}}, keys.core)}));
  assert.equal(dom.window.document.body.dataset.accessState, 'error');
  assert.ok(dom.window.document.querySelector('#collection').hidden);
  assert.equal(dom.window.document.querySelector('#access-retry').hidden, false); dom.window.close();
});
test('Network failure exposes no downloads', async () => {
  const dom = await openPage('#access=core.' + keys.core, async () => ({ok: false}));
  assert.equal(dom.window.document.body.dataset.accessState, 'error');
  assert.equal(dom.window.CATALOG, null);
  assert.equal(dom.window.document.querySelector('#cards').children.length, 0); dom.window.close();
});
module.exports = {openPage};
