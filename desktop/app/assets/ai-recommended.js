(function (root) {
  'use strict';
  var config = Object.freeze({ provider: 'recommended', base: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:1.5b', qualityModel: 'qwen3:4b-instruct', key: '' });
  var api = { config: config, apply: function (cfg) { return Object.assign({}, cfg, config); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GrafitRecommended = api;
})(typeof window !== 'undefined' ? window : globalThis);
