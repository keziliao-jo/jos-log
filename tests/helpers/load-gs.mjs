// Runs apps-script/Code.gs in node:vm with a CommonJS-style `module` shim.
// Values crossing the boundary are cloned so callers get host-realm objects
// (deepStrictEqual compares prototypes, which differ between vm realms).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CODE_PATH = fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function loadGs() {
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(CODE_PATH, 'utf8'), sandbox, { filename: 'Code.gs' });
  const gs = sandbox.module.exports;
  return {
    HEADERS: clone(gs.HEADERS),
    authPrecheck: (req, expected) => clone(gs.authPrecheck(clone(req), expected)),
    handle(req, ctx) {
      const store = ctx && ctx.store;
      const wrapped = store
        ? {
            readAll: () => store.readAll(),
            append: (row) => store.append(clone(row)),
            replaceAt: (index, row) => store.replaceAt(index, clone(row)),
          }
        : store;
      return clone(gs.handle(clone(req), { ...ctx, store: wrapped }));
    },
  };
}
