const { normalizeLicense, splitNameVersion, buildManifest } = require('./generate-oss-licenses');

describe('generate-oss-licenses', () => {
  describe('normalizeLicense', () => {
    it('returns the license string as-is', () => {
      expect(normalizeLicense('MIT')).toBe('MIT');
    });

    it('joins an array of licenses with OR', () => {
      expect(normalizeLicense(['MIT', 'Apache-2.0'])).toBe('MIT OR Apache-2.0');
    });

    it('degrades to UNKNOWN for a missing value, never throwing (AD-3)', () => {
      expect(normalizeLicense(undefined)).toBe('UNKNOWN');
      expect(normalizeLicense(null)).toBe('UNKNOWN');
      expect(normalizeLicense('')).toBe('UNKNOWN');
      expect(normalizeLicense('   ')).toBe('UNKNOWN');
    });
  });

  describe('splitNameVersion', () => {
    it('splits an unscoped package key', () => {
      expect(splitNameVersion('cbor-web@10.0.11')).toEqual({ name: 'cbor-web', version: '10.0.11' });
    });

    it('splits a scoped package key', () => {
      expect(splitNameVersion('@angular/core@19.2.19')).toEqual({
        name: '@angular/core',
        version: '19.2.19',
      });
    });

    it('falls back to an empty version when there is no @ separator after index 0', () => {
      expect(splitNameVersion('@1.0.0')).toEqual({ name: '@1.0.0', version: '' });
    });
  });

  describe('buildManifest', () => {
    it('maps package entries to name/version/license/repository', () => {
      const manifest = buildManifest({
        '@angular/core@19.2.19': {
          licenses: 'MIT',
          repository: 'https://github.com/angular/angular',
        },
      });

      expect(manifest.packages).toEqual([
        {
          name: '@angular/core',
          version: '19.2.19',
          license: 'MIT',
          repository: 'https://github.com/angular/angular',
        },
      ]);
      expect(manifest.generatedAt).toEqual(expect.any(String));
    });

    it('degrades an unparsable license to UNKNOWN instead of throwing (AD-3, R-6)', () => {
      const manifest = buildManifest({
        'some-pkg@1.0.0': { licenses: undefined, repository: undefined },
      });

      expect(manifest.packages[0]).toEqual({
        name: 'some-pkg',
        version: '1.0.0',
        license: 'UNKNOWN',
        repository: null,
      });
    });

    it('sorts packages by name then version for a deterministic diff (NFR-S-135-02)', () => {
      const manifest = buildManifest({
        'zeta@1.0.0': { licenses: 'MIT' },
        'alpha@2.0.0': { licenses: 'MIT' },
        'alpha@1.0.0': { licenses: 'MIT' },
      });

      expect(manifest.packages.map((p) => `${p.name}@${p.version}`)).toEqual([
        'alpha@1.0.0',
        'alpha@2.0.0',
        'zeta@1.0.0',
      ]);
    });

    it('handles an empty package set without throwing', () => {
      expect(buildManifest({})).toEqual({
        generatedAt: expect.any(String),
        packages: [],
      });
      expect(buildManifest(undefined).packages).toEqual([]);
    });

    it('drops entries whose key could not be split into a name and version', () => {
      const manifest = buildManifest({ '@1.0.0': { licenses: 'MIT' } });
      expect(manifest.packages).toEqual([]);
    });
  });
});
