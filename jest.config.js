module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ["<rootDir>/src/setup-jest.ts"],
  globalSetup: 'jest-preset-angular/global-setup',
  moduleNameMapper: {
    "@app/(.*)": "<rootDir>/src/app/$1",
    "@assets/(.*)": "<rootDir>/src/assets/$1",
    "@core/(.*)": "<rootDir>/src/app/core/$1",
    "@env": "<rootDir>/src/environments/environment",
    "@src/(.*)": "<rootDir>/src/src/$1",
    "@services/(.*)": "<rootDir>/src/app/core/services/$1",
    "@helpers/(.*)": "<rootDir>/src/app/helpers/$1",
    "@shared/(.*)": "<rootDir>/src/app/shared/$1",
    '^src/(.*)$': '<rootDir>/src/$1'
  },
  collectCoverage: true,
  coverageDirectory: "./coverage/app",
  coverageReporters: ["lcov", "text-summary", "cobertura", "html", "json-summary", "json"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.d.ts",
    "!src/environments/**",
    "!src/app/app.routes.ts",
    "!src/app/core/constants/**",
    "!src/app/features/credentials/credentials.page.ts",
    "!src/app/features/tabs/tabs.routes.ts",
    "!src/main.ts",
    "!src/polyfills.ts",
    "!src/zone-flags.ts"
  ],
  coveragePathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
  ],
  transformIgnorePatterns: ['/node_modules/(?!@stencil|stencil)/'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    // '/src/app/main',
    // '/src/app/app.routes',
    // '/src/app/app.component',
    // '/src/app/components',
    // '/src/app/guards',
    // '/src/app/helpers',
    // '/src/app/interceptors',
    // '/src/app/interfaces',
    // '/src/app/pages',
    // '/src/app/services'
  ]
};
