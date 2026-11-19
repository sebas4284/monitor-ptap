import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.env.LH_BASE_URL || 'http://localhost:8082';
const output = process.env.LH_OUTPUT || '/audit/reports';
assert.ok(process.env.LH_EMAIL && process.env.LH_PASSWORD, 'Use the authorized local test account');
fs.mkdirSync(output, { recursive: true });
const results = [];
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  for (const width of [1366, 360]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const failures = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.setViewport({ width, height: width === 360 ? 800 : 900 });
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: width === 360 ? 'reduce' : 'no-preference' },
    ]);
    const clickText = async (text) => {
      await page.waitForFunction(
        (text) =>
          [
            ...(
              document.querySelector('[role="dialog"],[role="menu"]') || document
            ).querySelectorAll('button,[role="button"],a'),
          ].some((el) => el.textContent.includes(text)),
        {},
        text,
      );
      const element = await page.evaluateHandle(
        (text) =>
          [
            ...(
              document.querySelector('[role="dialog"],[role="menu"]') || document
            ).querySelectorAll('button,[role="button"],a'),
          ].find((el) => el.textContent.includes(text)),
        text,
      );
      assert.ok(element.asElement(), `Missing control: ${text}`);
      await element.asElement().click();
    };
    await page.goto(`${base}/tablero`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname === '/login');
    await page.waitForSelector('input[aria-label="Correo electrónico"]');
    assert.equal(
      await page.$('[aria-label="Buscar señal o unidad"]'),
      null,
      'Protected dashboard exposed without login',
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Login horizontal overflow',
    );
    await page.screenshot({ path: `${output}/login-${width}.png`, fullPage: true });
    await page.click('[aria-label="Mostrar contraseña"]');
    assert.equal(await page.$eval('input[aria-label="Contraseña"]', (el) => el.type), 'text');
    await page.click('[aria-label="Ocultar contraseña"]');
    assert.equal(await page.$eval('input[aria-label="Contraseña"]', (el) => el.type), 'password');
    const checkbox = '[role="checkbox"]';
    const remembered = await page.$eval(checkbox, (el) => el.getAttribute('aria-checked'));
    await page.click(checkbox);
    assert.notEqual(
      await page.$eval(checkbox, (el) => el.getAttribute('aria-checked')),
      remembered,
    );
    await page.click(checkbox);
    await clickText('¿Olvidaste tu contraseña?');
    await page.waitForFunction(() =>
      document.body.textContent.includes('Contacta al administrador de Aquora'),
    );
    await page.type('input[aria-label="Correo electrónico"]', process.env.LH_EMAIL);
    await page.type('input[aria-label="Contraseña"]', process.env.LH_PASSWORD);
    await page.click('button[aria-busy]');
    await page.waitForFunction(() => location.pathname === '/tablero');
    await page.waitForSelector('[aria-label="Buscar señal o unidad"]');
    await page.waitForSelector('[role="table"] [role="row"]');
    const fonts = await page.evaluate(() => ({
      network: performance
        .getEntriesByType('resource')
        .filter((entry) => /\.(woff2|ttf)(\?|$)/.test(entry.name))
        .map((entry) => entry.name),
      iconFaces: [...document.fonts]
        .filter((face) => face.family.includes('ionicons'))
        .map((face) => ({ family: face.family, status: face.status, display: face.display })),
    }));
    while (await page.$('[aria-label$="Toca para descartar."]')) {
      await page.click('[aria-label$="Toca para descartar."]');
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Dashboard horizontal overflow',
    );
    await page.screenshot({ path: `${output}/tablero-${width}.png`, fullPage: true });
    await page.type('[aria-label="Buscar señal o unidad"]', 'sin-coincidencias-qa');
    await page.waitForFunction(() =>
      document.body.textContent.includes('No hay lecturas que coincidan'),
    );
    await page.click('[aria-label="Limpiar búsqueda"]');
    await page.waitForSelector('[role="table"] [role="row"]');
    await page.type('[aria-label="Buscar señal o unidad"]', 'caudal');
    await page.click('[role="tab"][aria-label="Válvulas"]');
    await page.waitForFunction(() => location.pathname === '/electrovalvulas');
    await page.click('[role="tab"][aria-label="Tablero"]');
    await page.waitForSelector('main [aria-label="Buscar señal o unidad"],[role="main"] [aria-label="Buscar señal o unidad"]');
    assert.equal(await page.$eval('main [aria-label="Buscar señal o unidad"],[role="main"] [aria-label="Buscar señal o unidad"]', input => input.value), 'caudal', 'Tab navigation lost the reading filter');
    await page.click('main [aria-label="Limpiar búsqueda"],[role="main"] [aria-label="Limpiar búsqueda"]');
    await page.screenshot({ path: `${output}/lecturas-${width}.png`, fullPage: true });
    await page.click('[aria-label="Buscar sección"]');
    await page.type('[aria-label="Nombre de la sección"]', 'alertas');
    await clickText('Alertas');
    await page.waitForFunction(() => location.pathname === '/alertas');
    await page.goBack({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname === '/tablero');
    await page.waitForSelector('[aria-label="Buscar señal o unidad"]');
    await page.click('[aria-label^="Perfil y menú"]');
    await page.click('[aria-label="Cerrar sesión"]');
    await page.waitForFunction(() => location.pathname === '/login');
    await page.goto(`${base}/tablero`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname === '/login');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    assert.deepEqual(failures, [], 'Failed requests');
    results.push({ width, reducedMotion: width === 360, passed: true, errors, failures, fonts });
    await context.close();
  }
  fs.writeFileSync(`${output}/ui-check.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  for (const [index, page] of (await browser.pages()).entries()) {
    if (page.url().startsWith(base)) {
      await page.screenshot({ path: `${output}/ui-failure-${index}.png`, fullPage: true });
      console.error(
        'Failed page',
        page.url(),
        await page.evaluate(() =>
          [...document.querySelectorAll('button,[role="button"],[role="menu"]')].map((el) => ({
            role: el.getAttribute('role'),
            text: el.textContent.trim().slice(0, 90),
          })),
        ),
      );
    }
  }
  throw error;
} finally {
  await browser.close();
}
