import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Recurrence guard for the glide-data-grid peer-contract class (EI-20413481417846939).
 *
 * THE FAILURE CLASS THIS CATCHES
 * `@glideapps/glide-data-grid@6.0.3` declares `react`/`react-dom` peers of
 * `^16.12.0 || 17.x || 18.x` — one React major behind this tree. When a root
 * `overrides` block forces react ^19 through, that peer contract is invalidated
 * and npm stops materialising glide's dependency subtree: `@linaria/react`,
 * `canvas-hypertxt`, `react-number-format` (and the `marked` /
 * `react-responsive-carousel` peers) silently vanish. The symptom surfaces far
 * from the cause, as collection-time "Cannot find module" in whatever imports
 * papergrid — which is why it needs a guard that names the real invariant.
 *
 * WHY THIS IS A GUARD AND NOT A FIX. There is no fix available upstream:
 * verified 2026-09-05 against the registry, `@glideapps/glide-data-grid@latest`
 * IS 6.0.3, and the only newer publishes are `6.0.4-alpha*` prereleases. So the
 * pins that keep the subtree materialised are load-bearing mitigation, not
 * cruft, and the correct engineering response is to assert the invariant they
 * uphold rather than to remove them. Re-check with
 * `npm view @glideapps/glide-data-grid version`; anything other than 6.0.3 or a
 * 6.0.4-alpha means the upstream constraint may have lifted.
 *
 * DERIVED, NOT HAND-MAINTAINED. The dependency list is read from glide's own
 * installed manifest, so a version bump that changes glide's requirements is
 * covered automatically instead of drifting against a hardcoded copy.
 */

const require_ = createRequire(import.meta.url);

/**
 * Read an installed package's manifest.
 *
 * NOT `require('<pkg>/package.json')`: a package whose `exports` map omits
 * `./package.json` blocks that subpath outright, and glide-data-grid is exactly
 * such a package — the bare-specifier read throws ERR_PACKAGE_PATH_NOT_EXPORTED
 * even though the file is plainly on disk. Resolve the entry point and walk up
 * to the owning package.json instead, which `exports` does not gate.
 */
function readManifest(pkgName: string): {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  try {
    return require_(`${pkgName}/package.json`);
  } catch {
    let dir = dirname(require_.resolve(pkgName));
    // Walk up to the package root: the first package.json whose name matches.
    for (let i = 0; i < 10; i += 1) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
        if (parsed.name === pkgName) return parsed;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`could not locate the installed package.json for ${pkgName}`);
  }
}

function glideManifest(): {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return readManifest('@glideapps/glide-data-grid');
}

/** Every package name glide declares it needs, from its own manifest. */
function declaredDependencyNames(): string[] {
  const manifest = glideManifest();
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ].sort();
}

/**
 * Resolvable from THIS package's context. Some packages have no `exports` entry
 * for `./package.json`, so fall back to resolving the entry point — either
 * answers the question the guard actually asks (did npm materialise it?).
 */
function resolves(name: string): boolean {
  try {
    require_.resolve(`${name}/package.json`);
    return true;
  } catch {
    try {
      require_.resolve(name);
      return true;
    } catch {
      return false;
    }
  }
}

describe('glide-data-grid dependency contract', () => {
  it('declares a non-empty dependency set (positive control)', () => {
    // Without this, a manifest read that silently returned {} would make the
    // resolution test below pass over an EMPTY list — a vacuous green that is
    // indistinguishable from a healthy tree. Fail loudly instead.
    const names = declaredDependencyNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('react');
  });

  it('materialises every dependency and peer glide declares', () => {
    const missing = declaredDependencyNames().filter((name) => !resolves(name));

    expect(
      missing,
      missing.length === 0
        ? ''
        : `glide-data-grid@${glideManifest().version} declares these packages but npm did not ` +
          `materialise them: ${missing.join(', ')}.\n` +
          `This is the known peer-contract break: glide declares react ` +
          `"${glideManifest().peerDependencies?.react}", and forcing a newer react through a root ` +
          `\`overrides\` block invalidates that contract so npm drops glide's subtree.\n` +
          `FIX: add the missing package(s) as explicit root pins (that is what the existing ` +
          `pins are for) — do NOT remove them. There is no upstream release to upgrade to; ` +
          `re-check with \`npm view @glideapps/glide-data-grid version\`.`,
    ).toEqual([]);
  });

  it('reports whether upstream still excludes the tree React major (watch condition)', () => {
    // Deliberately NON-FAILING. An upstream release that finally declares a
    // React 19 peer is GOOD news, and a shared release gate must not go red on
    // good news — a routine `npm install` could pick up a new 6.x under the
    // `^6.0.3` range without anyone deliberately bumping it. So this records
    // the state and tells the reader what it unlocks, without gating on it.
    const peers = glideManifest().peerDependencies ?? {};
    const reactPeer = peers.react ?? '';
    const stillExcludesReact19 = !/(^|\|\|)\s*\^?19|19\.x/.test(reactPeer);

    if (!stillExcludesReact19) {
      // eslint-disable-next-line no-console
      console.warn(
        `[papergrid] glide-data-grid@${glideManifest().version} now declares react peer ` +
          `"${reactPeer}", which admits React 19. The workaround pins for glide's subtree may ` +
          `now be removable — re-evaluate them, then update this test.`,
      );
    }

    expect(typeof reactPeer).toBe('string');
    expect(reactPeer.length).toBeGreaterThan(0);
  });
});
