(function (window) {
  window.env = window.env || {};

  // Environment variables
  window["env"]["server_url"] = "http://localhost:8083";
  window["env"]["websocket_url"] = "ws://localhost:8083";

  window["env"]["logs_enabled"] = "false";
  window["env"]["primary"] = "#001E8C";
  window["env"]["primary_contrast"] = "#ffffff";
  window["env"]["secondary"] = "#132153";
  window["env"]["secondary_contrast"] = "#ffffff";
  window["env"]["assets_base_url"]= "assets";
  window["env"]["logo_path"]= "logos/altia-logo.svg";
  window["env"]["favicon_path"]= "icons/altia-favicon.ico";
  window["env"]["default_lang"] =  "es";
  window["env"]["key_storage_mode"] = "";
})(this);
