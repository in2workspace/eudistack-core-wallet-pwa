import {
  flattenUiBundle, inflateUiBundle, mergeUiBundles, isExcludedKey, hashUiBundle, UiTextBundle,
} from './ui-text-bundle';
import { UiTextKey } from 'src/app/core/models/ui-text-translation.model';

describe('flattenUiBundle', () => {
  it('flattens a nested bundle into dotted-path entries', () => {
    const bundle: UiTextBundle = {
      menu: { scan: 'Escáner QR', credentials: 'Credenciales' },
      credentials: { title: 'Credenciales' },
    };

    const entries = flattenUiBundle(bundle);

    expect(entries).toEqual([
      { key: 'menu.scan', text: 'Escáner QR' },
      { key: 'menu.credentials', text: 'Credenciales' },
      { key: 'credentials.title', text: 'Credenciales' },
    ]);
  });

  it('returns an empty array for an empty bundle', () => {
    expect(flattenUiBundle({})).toEqual([]);
  });

  it('skips non-string, non-object leaves without throwing', () => {
    const bundle = { a: 'ok', b: 42, c: null, d: ['x'] } as unknown as UiTextBundle;

    expect(flattenUiBundle(bundle)).toEqual([{ key: 'a', text: 'ok' }]);
  });

  it('handles arbitrarily deep nesting', () => {
    const bundle: UiTextBundle = { a: { b: { c: { d: 'deep' } } } };

    expect(flattenUiBundle(bundle)).toEqual([{ key: 'a.b.c.d', text: 'deep' }]);
  });
});

describe('inflateUiBundle', () => {
  it('rebuilds a nested bundle from flat entries', () => {
    const entries = [
      { key: 'menu.scan' as UiTextKey, text: 'Escáner QR' },
      { key: 'menu.credentials' as UiTextKey, text: 'Credenciales' },
      { key: 'credentials.title' as UiTextKey, text: 'Credenciales' },
    ];

    expect(inflateUiBundle(entries)).toEqual({
      menu: { scan: 'Escáner QR', credentials: 'Credenciales' },
      credentials: { title: 'Credenciales' },
    });
  });

  it('round-trips through flattenUiBundle', () => {
    const bundle: UiTextBundle = { a: { b: 'x', c: 'y' }, d: 'z' };

    expect(inflateUiBundle(flattenUiBundle(bundle))).toEqual(bundle);
  });

  it('returns an empty bundle for an empty entry list', () => {
    expect(inflateUiBundle([])).toEqual({});
  });
});

describe('mergeUiBundles', () => {
  it('overrides pristine values with translated ones, key by key', () => {
    const pristine: UiTextBundle = { menu: { scan: 'Escáner QR', wallet: 'Cartera' } };
    const translated: UiTextBundle = { menu: { scan: 'QR Scanner' } };

    expect(mergeUiBundles(pristine, translated)).toEqual({
      menu: { scan: 'QR Scanner', wallet: 'Cartera' },
    });
  });

  it('never drops a pristine key absent from the translated subset (EC-06)', () => {
    const pristine: UiTextBundle = { a: 'A', b: 'B', nested: { x: 'X', y: 'Y' } };
    const translated: UiTextBundle = { nested: { x: 'X-translated' } };

    const merged = mergeUiBundles(pristine, translated);

    expect(merged['a']).toBe('A');
    expect(merged['b']).toBe('B');
    expect((merged['nested'] as UiTextBundle)['y']).toBe('Y');
    expect((merged['nested'] as UiTextBundle)['x']).toBe('X-translated');
  });

  it('does not mutate its inputs', () => {
    const pristine: UiTextBundle = { a: 'A' };
    const translated: UiTextBundle = { a: 'A-translated' };

    mergeUiBundles(pristine, translated);

    expect(pristine['a']).toBe('A');
    expect(translated['a']).toBe('A-translated');
  });

  it('merges an empty translated subset into an unchanged copy of pristine', () => {
    const pristine: UiTextBundle = { a: 'A', nested: { x: 'X' } };

    expect(mergeUiBundles(pristine, {})).toEqual(pristine);
  });
});

describe('isExcludedKey', () => {
  it.each([
    ['vc-fields.title', true],
    ['vc-fields.credentialInfo.issuerId', true],
    ['verification.button', true],
    ['verification.result-valid', true],
    ['menu.scan', false],
    ['credentials.title', false],
    ['', false],
  ])('isExcludedKey(%s) === %s', (key, expected) => {
    expect(isExcludedKey(key)).toBe(expected);
  });
});

describe('hashUiBundle', () => {
  it('is deterministic for the same input', () => {
    const json = JSON.stringify({ a: 'A', b: 'B' });

    expect(hashUiBundle(json)).toBe(hashUiBundle(json));
  });

  it('produces different hashes for different input (EC-05: release drift)', () => {
    const v1 = JSON.stringify({ a: 'A' });
    const v2 = JSON.stringify({ a: 'A-changed' });

    expect(hashUiBundle(v1)).not.toBe(hashUiBundle(v2));
  });

  it('returns an 8-char lowercase hex string', () => {
    expect(hashUiBundle('{}')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles the empty string', () => {
    expect(hashUiBundle('')).toMatch(/^[0-9a-f]{8}$/);
  });
});
