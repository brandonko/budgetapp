const { test: base, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const root = path.resolve(__dirname, '../..');

const test = base.extend({
  ledger: async ({}, use) => {
    const child = spawn(process.env.LEDGER_TEST_PYTHON || 'python',
      ['-u', path.join(__dirname, 'server.py')], {
        cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16_000); });
    const closed = new Promise(resolve => child.once('close', code => resolve(code)));
    try {
      const server = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Synthetic server did not start: ${stderr}`)), 15_000);
        const fail = error => { clearTimeout(timeout); reject(error); };
        child.once('error', fail);
        child.once('exit', code => fail(new Error(`Synthetic server exited (${code}): ${stderr}`)));
        lines.once('line', line => {
          clearTimeout(timeout);
          try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
        });
      });
      await use({
        ...server,
        bytes: () => readFile(server.csvPath),
        backups: async () => {
          const directory = path.join(path.dirname(server.csvPath), 'backups');
          const names = await readdir(directory).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
          });
          return Promise.all(names.filter(name => name.endsWith('.csv')).sort()
            .map(name => readFile(path.join(directory, name))));
        },
      });
    } finally {
      child.stdin.end();
      let timer;
      try {
        const code = await Promise.race([
          closed,
          new Promise((_, reject) => { timer = setTimeout(() => {
            child.kill();
            reject(new Error('Synthetic server did not shut down cleanly.'));
          }, 8_000); }),
        ]);
        if (code !== 0) throw new Error(`Synthetic server failed (${code}): ${stderr}`);
      } finally {
        clearTimeout(timer);
        lines.close();
      }
    }
  },
  baseURL: async ({ ledger }, use) => { await use(ledger.baseURL); },
  context: async ({ context, ledger }, use) => {
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    // This is an isolated browser, with no personal profile, source websites,
    // extension credentials, or requests to a running user's Ledger instance.
    await context.route('**/*', route => {
      return new URL(route.request().url()).origin === ledger.baseURL ? route.continue() : route.abort();
    });
    await use(context);
    expect(errors, 'Uncaught browser errors').toEqual([]);
  },
});

module.exports = { test, expect };
