// this environment is the one used in development mode ("ng serve")
// Reads from window.env (populated by assets/env.js) with local dev fallbacks.
// To apply tenant branding locally, run: make wallet-env [T=<tenant>]
export const environment = {
  production: false,
  server_url: window["env"]?.["server_url"] || 'http://localhost:8083',
  websocket_url: window["env"]?.["websocket_url"] || 'ws://localhost:8083',
  logs_enabled: window["env"]?.["logs_enabled"] === "true" || false,
  key_storage_mode: window["env"]?.["key_storage_mode"] || 'browser',
  appVersion: '3.0.0',
};
