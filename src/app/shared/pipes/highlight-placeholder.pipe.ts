import { Pipe, PipeTransform } from '@angular/core';

/**
 * Wraps a literal `{{placeholder}}` token still present in an *untranslated*
 * (no-params) translation string with a styled `<span>`, so a single i18n key
 * with interpolation (translator-friendly, correct word order per locale) can
 * still have its interpolated value visually highlighted. Replaces the raw
 * placeholder text instead of searching for the resolved value, so it can't
 * accidentally match an unrelated digit/word elsewhere in the sentence.
 * Pure, so chaining it after `translate` (`'key' | translate | highlightPlaceholder: ...`)
 * re-renders on a runtime language change for free — call `| translate` with
 * no params so the placeholder is left untouched for this pipe to replace.
 */
@Pipe({
  name: 'highlightPlaceholder',
  standalone: true,
})
export class HighlightPlaceholderPipe implements PipeTransform {
  transform(rawTranslation: string, placeholder: string, value: string | number, cssClass: string): string {
    return rawTranslation.replace(placeholder, `<span class="${cssClass}">${value}</span>`);
  }
}
