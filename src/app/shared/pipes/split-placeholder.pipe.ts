import { Pipe, PipeTransform } from '@angular/core';

/** The text before and after a placeholder of a translation. */
export interface PlaceholderParts {
  before: string;
  after: string;
}

/**
 * Splits a translation string obtained without params (`'key' | translate`) at a literal
 * placeholder such as `{{count}}`, so the template can render the interpolated value in its
 * own element (e.g. highlighted) between the two texts. Everything stays text: no HTML is
 * built (EUD-332). Returns null when the placeholder is missing. Pure, so chaining it after
 * `translate` re-renders on a runtime language change.
 */
@Pipe({
  name: 'splitPlaceholder',
  standalone: true,
})
export class SplitPlaceholderPipe implements PipeTransform {
  transform(rawTranslation: string | null | undefined, placeholder: string): PlaceholderParts | null {
    const text = String(rawTranslation ?? '');
    const index = text.indexOf(placeholder);
    if (index < 0) {
      return null;
    }
    return { before: text.slice(0, index), after: text.slice(index + placeholder.length) };
  }
}
