// this environment is the one used in development mode ("ng serve")
// Reads from window.env (populated by assets/env.js) with local dev fallbacks.
// To apply tenant branding locally, run: make wallet-env [T=<tenant>]
export const environment = {
  production: false,
  server_url: window["env"]?.["server_url"] || 'http://localhost:8083',
  websocket_url: window["env"]?.["websocket_url"] || 'ws://localhost:8083',
  logs_enabled: window["env"]?.["logs_enabled"] === "true",
  wallet_mode: window["env"]?.["wallet_mode"] || 'browser',
  preferred_grant: window["env"]?.["preferred_grant"] || 'auto',
  oid4vci_redirect_uri: window["env"]?.["oid4vci_redirect_uri"] || 'http://localhost/callback',
  wia: window["env"]?.["wia"] || '',
  wia_instance_key_jwk: window["env"]?.["wia_instance_key_jwk"] || '',
  appVersion: '3.0.0',
};
