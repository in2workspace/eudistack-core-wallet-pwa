import { SplitPlaceholderPipe } from './split-placeholder.pipe';

describe('SplitPlaceholderPipe', () => {
  let pipe: SplitPlaceholderPipe;

  beforeEach(() => {
    pipe = new SplitPlaceholderPipe();
  });

  it('splits the translation at the placeholder', () => {
    expect(pipe.transform('Hay {{count}} credenciales válidas para presentar', '{{count}}'))
      .toEqual({ before: 'Hay ', after: ' credenciales válidas para presentar' });
  });

  it('does not split at text that only looks like the value', () => {
    expect(pipe.transform('Step 1 of {{count}}', '{{count}}')).toEqual({ before: 'Step 1 of ', after: '' });
  });

  it('keeps markup as plain text in both parts', () => {
    expect(pipe.transform('<b>x</b> {{count}} <img src=x onerror=alert(1)>', '{{count}}'))
      .toEqual({ before: '<b>x</b> ', after: ' <img src=x onerror=alert(1)>' });
  });

  it('returns null when the placeholder is missing', () => {
    expect(pipe.transform('No placeholder here', '{{count}}')).toBeNull();
    expect(pipe.transform(undefined, '{{count}}')).toBeNull();
  });
});
