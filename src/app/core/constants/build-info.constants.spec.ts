import { BUILD_INFO } from './build-info.constants';

// eslint-disable-next-line @typescript-eslint/no-var-requires, no-var
declare var require: (id: string) => { version: string };
const packageJson = require('../../../../package.json');

describe('BUILD_INFO', () => {
  it('matches the version declared in package.json exactly (NFR-S-135-01)', () => {
    expect(BUILD_INFO.version).toBe(packageJson.version);
  });

  it('never has an empty, undefined, or unsubstituted-placeholder buildId (EC-05)', () => {
    expect(BUILD_INFO.buildId).toBeTruthy();
    expect(BUILD_INFO.buildId).not.toBe('');
    expect(BUILD_INFO.buildId).not.toContain('{{');
    expect(/^([0-9a-f]{7,40}|local)$/.test(BUILD_INFO.buildId)).toBe(true);
  });

  it('has an ISO-8601 parseable builtAt timestamp', () => {
    expect(Number.isNaN(Date.parse(BUILD_INFO.builtAt))).toBe(false);
  });
});
