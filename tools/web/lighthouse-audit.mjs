import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import lighthouse from 'lighthouse';
import desktop from 'lighthouse/core/config/desktop-config.js';
import { launch } from 'chrome-launcher';
import puppeteer from 'puppeteer-core';

// Run in the isolated audit environment documented in the Lighthouse report.
const base = process.env.LH_BASE_URL || 'http://localhost:8082';
const phase = process.env.LH_PHASE || 'baseline';
const repeats = Number(process.env.LH_REPEATS || 1);
assert.ok(Number.isInteger(repeats) && repeats >= 1, 'LH_REPEATS must be a positive integer');
assert.ok(
  (process.env.LH_PROFILES || 'mobile,desktop')
    .split(',')
    .every((profile) => ['mobile', 'desktop'].includes(profile)),
  'Use official mobile/desktop profiles',
);
const output = process.env.LH_OUTPUT || '/audit/reports';
fs.mkdirSync(output, { recursive: true });
const summaries = [];
// Keep Lighthouse's heap and internal caches out of subsequent samples.
if (!process.env.LH_SINGLE_RUN) {
  for (const route of (process.env.LH_ROUTES || 'login,tablero').split(',')) {
    for (const profile of (process.env.LH_PROFILES || 'mobile,desktop').split(',')) {
      for (let run = 1; run <= repeats; run++) {
        execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
          env: {
            ...process.env,
            LH_SINGLE_RUN: String(run),
            LH_REPEATS: '1',
            LH_ROUTES: route,
            LH_PROFILES: profile,
          },
          stdio: 'inherit',
        });
        summaries.push(
          ...JSON.parse(fs.readFileSync(path.join(output, `${phase}-summary.json`), 'utf8')),
        );
      }
    }
  }
  fs.writeFileSync(path.join(output, `${phase}-summary.json`), JSON.stringify(summaries, null, 2));
  process.exit(0);
}
for (const route of (process.env.LH_ROUTES || 'login,tablero').split(',')) {
  for (const profile of (process.env.LH_PROFILES || 'mobile,desktop').split(',')) {
    for (let sample = 1; sample <= repeats; sample++) {
      const run = Number(process.env.LH_SINGLE_RUN || sample);
      const chrome = await launch({
        chromePath: '/usr/bin/chromium',
        chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
      });
      try {
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
        try {
          const page = await browser.newPage();
          if (route === 'tablero') {
            if (!process.env.LH_EMAIL || !process.env.LH_PASSWORD)
              throw new Error('Provide authorized local test credentials');
            await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
            await page.waitForSelector('input[aria-label="Correo electrónico"]');
            await page.type('input[aria-label="Correo electrónico"]', process.env.LH_EMAIL);
            await page.type('input[aria-label="Contraseña"]', process.env.LH_PASSWORD);
            const submit = await page.$('button[aria-busy]');
            if (!submit) throw new Error('Login submit not found');
            await submit.click();
            await page.waitForFunction(() => location.pathname === '/tablero');
            await page.waitForSelector('[aria-label="Buscar señal o unidad"]');
          }
          const session = await page.createCDPSession();
          await session.send('Network.clearBrowserCache');
          await page.close();
        } finally {
          browser.disconnect();
        }
        const result = await lighthouse(
          `${base}/${route}`,
          {
            port: chrome.port,
            output: ['html', 'json'],
            logLevel: 'error',
            onlyCategories: ['performance', 'accessibility', 'best-practices'],
            disableStorageReset: true,
          },
          profile === 'desktop' ? desktop : undefined,
        );
        const { lhr } = result;
        if (lhr.runtimeError || new URL(lhr.finalDisplayedUrl).pathname !== `/${route}`) {
          throw new Error(`Invalid audit: ${lhr.runtimeError?.message || lhr.finalDisplayedUrl}`);
        }
        const stem = `${phase}-${route}-${profile}-${run}`;
        fs.writeFileSync(path.join(output, `${stem}.html`), result.report[0]);
        fs.writeFileSync(path.join(output, `${stem}.json`), result.report[1]);
        const summary = {
          phase,
          route,
          profile,
          run,
          lighthouseVersion: lhr.lighthouseVersion,
          scores: Object.fromEntries(
            Object.entries(lhr.categories).map(([key, value]) => [
              key,
              Math.round(value.score * 100),
            ]),
          ),
          metrics: Object.fromEntries(
            [
              'first-contentful-paint',
              'largest-contentful-paint',
              'total-blocking-time',
              'cumulative-layout-shift',
              'speed-index',
            ].map((key) => [key, lhr.audits[key].numericValue]),
          ),
          warnings: lhr.runWarnings,
          settings: lhr.configSettings,
        };
        summaries.push(summary);
        fs.writeFileSync(
          path.join(output, `${phase}-summary.json`),
          JSON.stringify(summaries, null, 2),
        );
        console.log(JSON.stringify({ ...summary, settings: undefined }));
      } finally {
        await chrome.kill();
      }
    }
  }
}
