(function (window) {
  window.env = window.env || {};

  // Wallet API: empty = same-origin proxy mode (Atlassian-style)
  window["env"]["server_url"] = "${WALLET_API_EXTERNAL_URL}/wallet";
  window["env"]["websocket_url"] = "${WALLET_API_WEBSOCKET_EXTERNAL_URL}/wallet";
  window["env"]["logs_enabled"] = "${LOGS_ENABLED}";
  window["env"]["wallet_mode"] = "${WALLET_MODE}";
  window["env"]["preferred_grant"] = "${PREFERRED_GRANT}";
  window["env"]["oid4vci_redirect_uri"] = "";
  window["env"]["wia"] = "${WIA}";
  window["env"]["wia_instance_key_jwk"] = '${WIA_INSTANCE_KEY_JWK}';
})(this);
