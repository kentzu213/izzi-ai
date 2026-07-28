'use strict';
/**
 * Voice Studio extension - thin client over the local VieNeu-TTS backend booted
 * by Izzi AI's LocalServiceManager. The host must inject `backendUrl`.
 */
var ctx = null;
var MAX_TEXT_LENGTH = 500;
var MAX_AUDIO_BYTES = 8 * 1024 * 1024;
var MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
var LOOPBACK_BACKEND_PATTERN = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/;
var VOICE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
var CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
var WAV_BASE64_PATTERN = /^UklGR[A-Za-z0-9+/]*={0,2}$/;

function normalizeBackend(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.replace(/\/+$/, '');
  var match = LOOPBACK_BACKEND_PATTERN.exec(trimmed);
  if (!match) return null;
  var port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? trimmed : null;
}

async function backendUrl() {
  try {
    return normalizeBackend(await ctx.storage.get('backendUrl'));
  } catch (e) {
    return null;
  }
}

function parseTtsInput(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  var keys = Object.keys(args).sort();
  if (keys.length !== 2 || keys[0] !== 'text' || keys[1] !== 'voice') return null;
  if (
    typeof args.text !== 'string'
    || args.text.length < 1
    || args.text.length > MAX_TEXT_LENGTH
    || args.text.trim() !== args.text
    || CONTROL_CHARACTER_PATTERN.test(args.text)
    || typeof args.voice !== 'string'
    || !VOICE_PATTERN.test(args.voice)
  ) return null;
  return { text: args.text, voice: args.voice };
}

function validPcmWavBase64(value) {
  if (
    typeof value !== 'string'
    || value.length < 16
    || value.length > MAX_AUDIO_BASE64_LENGTH
    || value.length % 4 !== 0
    || !WAV_BASE64_PATTERN.test(value)
  ) return false;

  var data;
  try { data = Buffer.from(value, 'base64'); } catch (e) { return false; }
  if (
    data.length < 44
    || data.length > MAX_AUDIO_BYTES
    || data.toString('base64') !== value
    || data.toString('ascii', 0, 4) !== 'RIFF'
    || data.toString('ascii', 8, 12) !== 'WAVE'
  ) return false;

  var riffEnd = data.readUInt32LE(4) + 8;
  if (riffEnd !== data.length || riffEnd < 44) return false;

  var offset = 12;
  var hasFormat = false;
  var hasData = false;
  while (offset + 8 <= riffEnd) {
    var chunkId = data.toString('ascii', offset, offset + 4);
    var chunkSize = data.readUInt32LE(offset + 4);
    var dataStart = offset + 8;
    var dataEnd = dataStart + chunkSize;
    var paddedEnd = dataEnd + (chunkSize % 2);
    if (dataEnd > riffEnd || paddedEnd > riffEnd) return false;

    if (chunkId === 'fmt ') {
      if (
        hasFormat
        || chunkSize < 16
        || data.readUInt16LE(dataStart) !== 1
        || data.readUInt16LE(dataStart + 2) !== 1
        || data.readUInt32LE(dataStart + 4) !== 48000
        || data.readUInt32LE(dataStart + 8) !== 96000
        || data.readUInt16LE(dataStart + 12) !== 2
        || data.readUInt16LE(dataStart + 14) !== 16
      ) return false;
      hasFormat = true;
    } else if (chunkId === 'data') {
      if (hasData || chunkSize === 0 || chunkSize % 2 !== 0) return false;
      hasData = true;
    }
    offset = paddedEnd;
  }
  return offset === riffEnd && hasFormat && hasData;
}

async function getJson(path) {
  var base = await backendUrl();
  if (!base) return { status: 0, data: null, error: 'managed-backend-not-injected' };
  try {
    var res = await ctx.net.fetch(base + path, { method: 'GET', timeout: 15000 });
    var data = null;
    try { data = res && res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
    return { status: res ? res.status : 0, data: data };
  } catch (e) {
    return { status: 0, data: null, error: (e && e.message) || 'not-connected' };
  }
}

module.exports = {
  activate: function (context) {
    ctx = context;
    if (ctx.log && ctx.log.info) ctx.log.info('Voice Studio activated');
  },
  deactivate: function () { ctx = null; },
  commands: {
    'voice-studio.status': async function () {
      var base = await backendUrl();
      try {
        var result = await getJson('/health/ready');
        return {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
          error: result.error,
          backendUrl: base,
        };
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'not-connected', backendUrl: base };
      }
    },
    'voice-studio.listVoices': async function () {
      var result = await getJson('/voices');
      if (result.error) return { ok: false, error: result.error };
      if (result.status < 200 || result.status >= 300) {
        return { ok: false, error: 'http ' + result.status };
      }
      return { ok: true, voices: (result.data && result.data.voices) || [] };
    },
    'voice-studio.tts': async function (args) {
      var input = parseTtsInput(args);
      if (!input) return { ok: false, error: 'Payload TTS không hợp lệ' };
      var base = await backendUrl();
      if (!base) return { ok: false, error: 'managed-backend-not-injected' };

      var res;
      try {
        res = await ctx.net.fetch(base + '/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          timeout: 120000,
        });
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'not-connected' };
      }
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: 'http ' + res.status };
      }
      var data = null;
      try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
      if (
        !data
        || data.ok !== true
        || data.format !== 'wav'
        || !validPcmWavBase64(data.audio_b64)
      ) return { ok: false, error: 'tts failed' };
      return { ok: true, format: 'wav', audioB64: data.audio_b64 };
    },
  },
};