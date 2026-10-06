'use strict';

// Each backer URL carries only its own catalog key. No higher-tier key is shipped.
(function (global) {
  const tiers = new Set(['core', 'full', 'complete']);
  function parseAccess(hash) {
    const match = /^#access=(core|full|complete)\.([A-Za-z0-9_-]{43})$/.exec(hash);
    return match ? {tier: match[1], key: match[2]} : null;
  }
  function keyBytes(key) {
    return Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  }
  async function decryptCatalog(bytes, access, cryptoProvider = global.crypto) {
    if (!access || !tiers.has(access.tier) || bytes.byteLength < 29) throw new Error('Invalid access');
    const key = await cryptoProvider.subtle.importKey('raw', keyBytes(access.key), 'AES-GCM', false, ['decrypt']);
    const payload = new Uint8Array(bytes);
    const plain = await cryptoProvider.subtle.decrypt({name: 'AES-GCM', iv: payload.slice(0, 12),
      additionalData: new TextEncoder().encode('cursed-tales-2:' + access.tier)}, key, payload.slice(12));
    const catalog = JSON.parse(new TextDecoder().decode(plain));
    if (catalog.tier !== access.tier || !Array.isArray(catalog.items) || !catalog.access) throw new Error('Invalid catalog');
    return catalog;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {parseAccess, decryptCatalog};
    return;
  }
  const $ = selector => document.querySelector(selector);
  let loading = false;
  async function openLibrary() {
    if (loading) return;
    const access = parseAccess(location.hash);
    if (!access) {
      $('#access-title').textContent = 'Backer Library';
      $('#access-message').textContent = 'Open your set’s access link from your Kickstarter message.';
      $('#access-retry').hidden = true;
      document.body.dataset.accessState = 'locked';
      return;
    }
    loading = true;
    document.body.dataset.accessState = 'loading';
    $('#access-title').textContent = 'Opening your set…';
    $('#access-message').textContent = '';
    $('#access-retry').hidden = true;
    try {
      const response = await fetch('access/' + access.tier + '.bin?v=new-renders-bust-20261006', {cache: 'no-cache'});
      if (!response.ok) throw new Error('Catalog unavailable');
      const catalog = await decryptCatalog(await response.arrayBuffer(), access);
      global.CATALOG = catalog;
      if (!global.startLibrary) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'app.js?v=new-renders-bust-20261006';
          script.onload = resolve;
          script.onerror = reject;
          document.head.append(script);
        });
      }
      global.startLibrary();
      $('#tier-label').textContent = catalog.tierLabel;
      $('#tier-description').textContent = catalog.tierDescription;
      $('.package-label').textContent = catalog.tierLabel;
      $('.all-panel').setAttribute('aria-label', catalog.tierLabel);
      $('.archive-copy p').textContent = 'All available files in your set in one ZIP.';
      document.title = catalog.tierLabel + ' — Cursed Tales II';
      $('#access-gate').hidden = true;
      $('#tier-summary').hidden = false;
      $('.all-panel').hidden = false;
      $('#collection').hidden = false;
      document.body.dataset.accessState = 'ready';
    } catch (error) {
      global.CATALOG = null;
      $('#access-title').textContent = 'Unable to open your set';
      $('#access-message').textContent = 'Check that you copied the entire link. If it is correct, try again or contact the creator on Kickstarter.';
      $('#access-retry').hidden = false;
      document.body.dataset.accessState = 'error';
    } finally {
      loading = false;
    }
  }
  $('#access-retry').addEventListener('click', openLibrary);
  global.addEventListener('hashchange', () => {
    // A different access key starts with a clean document, without stale downloads.
    location.reload();
  });
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) { event.preventDefault(); target.scrollIntoView({behavior: 'smooth'}); }
    });
  }
  openLibrary();
})(typeof window === 'undefined' ? globalThis : window);
