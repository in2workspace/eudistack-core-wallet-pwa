// @ts-check
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = tseslint.config(
  {
    ignores: ["projects/**/*", "**/*.spec.ts", ".vscode/"],
  },
  {
    files: ["**/*.ts"],
    extends: [
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "app", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "app", style: "kebab-case" },
      ],
      "@typescript-eslint/explicit-member-accessibility": "warn",
      "@typescript-eslint/member-ordering": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [...angular.configs.templateRecommended],
    rules: {},
  },
  {
    // EUD-142 (AD-4/FR-25/NFR-Pr-03) privacy boundary, control 4/4: the runtime
    // UI translation layer must never import credential, activity or auth code —
    // its only legitimate input is the release i18n bundle (AD-2). Verified in CI.
    files: [
      "src/app/core/services/ui-text-translation.service.ts",
      "src/app/core/adapters/browser-translator-engine.adapter.ts",
      "src/app/shared/helpers/ui-text-bundle.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/credential*", "**/local-credential-storage*", "**/activity*", "**/auth*"],
              message:
                "EUD-142 privacy boundary: the runtime UI translation layer must not import " +
                "credential, activity or auth code (FR-25/NFR-Pr-03). Its only legitimate " +
                "input is the release i18n bundle.",
            },
          ],
        },
      ],
    },
  }
);
