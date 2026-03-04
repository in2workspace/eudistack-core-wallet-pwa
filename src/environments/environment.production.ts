// this file is the used when deploying (see Dockerfile);
// its values will be overwriten by env variables (see env.js & env.template.js)
export const environment = {
  production: true,
  server_url: window["env"]["server_url"] || "", // REQUIRED
  websocket_url: window["env"]["websocket_url"], // REQUIRED
  logs_enabled: window["env"]["logs_enabled"] === "true" || false, //OPTIONAL WITH fallback
  key_storage_mode: window["env"]["key_storage_mode"] || 'browser', // OPTIONAL with fallback
  appVersion: '3.0.0',
};
