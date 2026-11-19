import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

// A11y-only fixture: derive frozen readings in this browser, never alter the API or send commands.
const require = createRequire(import.meta.url);
const base = 'http://localhost:8082';
assert.ok(process.env.LH_EMAIL && process.env.LH_PASSWORD, 'Authorized local test account required');
const output = '/audit/frozen-ui';
fs.mkdirSync(output, { recursive: true });
const results = [];
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const width of [1366, 360]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: width === 360 ? 800 : 900 });
    await page.evaluateOnNewDocument(() => {
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = class extends OriginalWebSocket {
        constructor(url, protocols) {
          if (new URL(url, location.href).pathname.startsWith('/socket.io/')) {
            throw new DOMException('Socket.IO blocked by frozen UI fixture', 'NetworkError');
          }
          super(url, protocols);
        }
      };
    });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*://*/socket.io/*'] });
    let socketFrames = 0;
    cdp.on('Network.webSocketFrameReceived', () => { socketFrames++; });
    const errors = [];
    const commandRequests = [];
    let frozenSnapshot;
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      try {
        if (url.pathname.startsWith('/socket.io/')) return await request.abort();
        if (request.method() === 'POST' && /\/api\/plants\/[^/]+\/commands/.test(url.pathname)) {
          commandRequests.push(url.pathname);
          return await request.abort();
        }
        if (request.method() === 'GET' && /\/api\/plants\/[^/]+\/snapshot$/.test(url.pathname)) {
          assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
          if (!frozenSnapshot) {
            const response = await fetch(request.url(), { headers: { Authorization: request.headers().authorization } });
            assert.equal(response.status, 200);
            const source = await response.json();
            assert.equal(source.plantId, 'sim-una');
            frozenSnapshot = { ...source, liveness: { ...source.liveness, state: 'frozen' } };
          }
          return await request.respond({ status: 200, contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': base, 'Cache-Control': 'no-store' },
            body: JSON.stringify(frozenSnapshot) });
        }
        await request.continue();
      } catch (error) {
        errors.push(error.message);
        if (!request.isInterceptResolutionHandled()) await request.abort();
      }
    });
    await page.goto(base + '/login', { waitUntil: 'networkidle2' });
    await page.type('input[aria-label="Correo electrónico"]', process.env.LH_EMAIL);
    await page.type('input[aria-label="Contraseña"]', process.env.LH_PASSWORD);
    await page.click('button[aria-busy]');
    await page.waitForFunction(() => location.pathname === '/tablero');
    await page.waitForFunction(() => document.querySelector('main,[role="main"]')?.textContent.toLowerCase().includes('congelado'), { timeout: 10_000 }).catch(async error => {
      console.error(JSON.stringify({ errors, socketFrames, snapshot: frozenSnapshot && {
        plantId: frozenSnapshot.plantId, liveness: frozenSnapshot.liveness },
        main: await page.$eval('main,[role="main"]', node => node.textContent.slice(0, 500)) }));
      await page.screenshot({ path: output + '/fixture-failure.png', fullPage: true });
      throw error;
    });
    while (await page.$('[aria-label$="Toca para descartar."]')) await page.click('[aria-label$="Toca para descartar."]');
    for (const route of ['tablero', 'electrovalvulas']) {
      if (route === 'tablero') await page.type('[aria-label="Buscar señal o unidad"]', 'caudal');
      if (route === 'electrovalvulas') {
        const tab = await page.$('[role="tab"][aria-label="Válvulas"]');
        assert.ok(tab);
        await tab.click();
        await page.waitForFunction(() => location.pathname === '/electrovalvulas');
        await page.waitForFunction(() => document.querySelector('main,[role="main"]')?.textContent.toLowerCase().includes('congelado'));
      }
      let keyboardScroll;
      if (route === 'tablero' && width === 360) {
        const selector = '[role="region"][aria-label="Desplazar columnas de lecturas"]';
        await page.focus(selector);
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(selector => document.querySelector(selector).scrollLeft > 0, {}, selector);
        const right = await page.$eval(selector, node => node.scrollLeft);
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(selector => document.querySelector(selector).scrollLeft === 0, {}, selector);
        keyboardScroll = { right, left: await page.$eval(selector, node => node.scrollLeft) };
      }
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const axe = await page.evaluate(async () => window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      }));
      const state = await page.evaluate(() => {
        const main = document.querySelector('main,[role="main"]');
        const cards = [...main.querySelectorAll('div')].filter(element => getComputedStyle(element).borderStyle === 'dashed');
        return { mainCount: document.querySelectorAll('main,[role="main"]').length,
          frozen: main.textContent.toLowerCase().includes('congelado'),
          dashedCards: cards.length, fadedCards: cards.filter(element => Number(getComputedStyle(element).opacity) < 1).length,
          commandButtons: [...main.querySelectorAll('button,[role="button"]')]
            .filter(element => /^(Abrir|Cerrar|Liberar) /.test(element.getAttribute('aria-label') || '')).length,
          hiddenFocusable: [...document.querySelectorAll('[aria-hidden="true"]')].map(element => ({
            tag: element.tagName, classes: element.className, tabindex: element.getAttribute('tabindex'),
            display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility,
            children: [...element.querySelectorAll('button,input,[tabindex="0"]')].map(child => ({
              tag: child.tagName, label: child.getAttribute('aria-label') || child.textContent.slice(0, 40),
              tabindex: child.getAttribute('tabindex'), display: getComputedStyle(child).display,
            })),
          })).filter(element => element.children.length > 0) };
      });
      const result = { fixture: 'derived-http-frozen-socket-blocked', ruleset: 'WCAG2A/AA and WCAG2.1AA', route, width, state, keyboardScroll,
        violations: axe.violations.map(item => ({ id: item.id, impact: item.impact,
          nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })),
        incomplete: axe.incomplete.map(item => item.id), socketFrames, commandRequests, errors };
      fs.writeFileSync(`${output}/${route}-${width}.json`, JSON.stringify(result, null, 2));
      await page.screenshot({ path: `${output}/${route}-${width}.png`, fullPage: true });
      if (route === 'electrovalvulas') {
        await page.click('[role="tab"][aria-label="Tablero"]');
        await page.waitForSelector('main [aria-label="Buscar señal o unidad"],[role="main"] [aria-label="Buscar señal o unidad"]');
        result.retainedQuery = await page.$eval('main [aria-label="Buscar señal o unidad"],[role="main"] [aria-label="Buscar señal o unidad"]', input => input.value);
        fs.writeFileSync(`${output}/${route}-${width}.json`, JSON.stringify(result, null, 2));
      }
      results.push(result);
      assert.equal(state.mainCount, 1);
      assert.ok(state.frozen && state.dashedCards > 0);
      assert.equal(state.fadedCards, 0);
      assert.equal(state.commandButtons, 0);
      assert.equal(socketFrames, 0);
      assert.deepEqual(commandRequests, []);
      assert.deepEqual(errors, []);
      if (route === 'electrovalvulas') assert.equal(result.retainedQuery, 'caudal');
      assert.equal(axe.violations.filter(item => item.id === 'color-contrast').length, 0);
      assert.equal(axe.violations.length, 0, JSON.stringify(result.violations));
    }
    await context.close();
  }
  fs.writeFileSync(output + '/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
