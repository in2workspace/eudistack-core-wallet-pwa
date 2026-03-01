(function (window) {
  window.env = window.env || {};

  // Environment variables
  window["env"]["server_url"] = "http://localhost:8083";
  window["env"]["websocket_url"] = "ws://localhost:8083";

  window["env"]["logs_enabled"] = "false";
  window["env"]["primary"] = "#002060";
  window["env"]["primary_contrast"] = "#ffffff";
  window["env"]["secondary"] = "#001540";
  window["env"]["secondary_contrast"] = "#00ADD3";
  window["env"]["assets_base_url"]= "assets";
  window["env"]["logo_path"]= "logos/dome-logo.png";
  window["env"]["favicon_path"]= "icons/dome-favicon.png";
  window["env"]["default_lang"] =  "en";
  window["env"]["key_storage_mode"] = "server";
})(this);
