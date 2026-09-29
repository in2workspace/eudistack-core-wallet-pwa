import { HighlightPlaceholderPipe } from './highlight-placeholder.pipe';

describe('HighlightPlaceholderPipe', () => {
  let pipe: HighlightPlaceholderPipe;

  beforeEach(() => {
    pipe = new HighlightPlaceholderPipe();
  });

  it('wraps the placeholder with the given value and CSS class', () => {
    // Arrange
    const rawTranslation = 'Hay {{count}} credenciales válidas para presentar';

    // Act
    const result = pipe.transform(rawTranslation, '{{count}}', 3, 'credential-count-value');

    // Assert
    expect(result).toBe('Hay <span class="credential-count-value">3</span> credenciales válidas para presentar');
  });

  it('does not touch a digit that appears outside the placeholder', () => {
    // Arrange
    const rawTranslation = 'Step 1 of {{count}}';

    // Act
    const result = pipe.transform(rawTranslation, '{{count}}', 1, 'highlight');

    // Assert
    expect(result).toBe('Step 1 of <span class="highlight">1</span>');
  });

  it('returns the translation untouched when the placeholder is missing', () => {
    // Arrange
    const rawTranslation = 'No placeholder here';

    // Act
    const result = pipe.transform(rawTranslation, '{{count}}', 5, 'credential-count-value');

    // Assert
    expect(result).toBe('No placeholder here');
  });
});
