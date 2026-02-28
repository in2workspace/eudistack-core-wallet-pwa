// this environment is the one used in development mode ("ng serve")
// Reads from window.env (populated by assets/env.js) with local dev fallbacks.
// To apply tenant branding locally, run: make wallet-env [T=<tenant>]
export const environment = {
  production: false,
  server_url: window["env"]?.["server_url"] || 'http://localhost:8083',
  websocket_url: window["env"]?.["websocket_url"] || 'ws://localhost:8083',
  logs_enabled: window["env"]?.["logs_enabled"] === "true" || false,
  customizations:{
    colors:{
      primary: window["env"]?.["primary"] || '#184BFF',
      primary_contrast: window["env"]?.["primary_contrast"] || '#ffffff',
      secondary: window["env"]?.["secondary"] || '#132153',
      secondary_contrast: window["env"]?.["secondary_contrast"] || '#ffffff'
    },
    assets: {
      base_url: window["env"]?.["assets_base_url"] || "assets",
      logo_path: window["env"]?.["logo_path"] || "logos/altia-logo.svg",
      favicon_path: window["env"]?.["favicon_path"] || "icons/altia-favicon.ico",
    },
    default_lang: window["env"]?.["default_lang"] || "en",
  }
};
