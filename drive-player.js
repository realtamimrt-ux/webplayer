/*!
 * DrivePlayer — a friendly video player for public Google Drive videos.
 *
 *   <script src="drive-player.js"></script>
 *   <drive-player src="https://drive.google.com/file/d/FILE_ID/view"></drive-player>
 *
 * Modes:  inline (default) · floating (dashboard corner widget) · modal (lightbox)
 * No dependencies, no build step. MIT licensed.
 */
(function () {
  'use strict';

  if (window.customElements && customElements.get('drive-player')) return;

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  var STALL_MS = 15000; // give a source this long to start before trying the next one
  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function parseDriveId(input) {
    if (!input) return null;
    input = String(input).trim();
    if (/^https?:\/\//i.test(input)) {
      var host;
      try { host = new URL(input).hostname; } catch (e) { return null; }
      if (!/(^|\.)(drive|docs)\.google\.com$|(^|\.)drive\.usercontent\.google\.com$|(^|\.)googleapis\.com$/.test(host)) return null;
      var m = input.match(/\/(?:file\/)?d\/([\w-]{10,})/) || input.match(/[?&]id=([\w-]{10,})/) || input.match(/\/files\/([\w-]{10,})/);
      return m ? m[1] : null;
    }
    return /^[\w-]{10,}$/.test(input) ? input : null;
  }

  function driveSources(id, apiKey) {
    var list = [];
    if (apiKey) list.push('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&key=' + encodeURIComponent(apiKey));
    list.push('https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t');
    list.push('https://drive.google.com/uc?export=download&id=' + id);
    return list;
  }

  var driveUrls = {
    preview: function (id) { return 'https://drive.google.com/file/d/' + id + '/preview'; },
    view: function (id) { return 'https://drive.google.com/file/d/' + id + '/view'; },
    thumb: function (id) { return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1280'; }
  };

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  function parseTime(str) {
    if (str == null || str === '') return NaN;
    var parts = String(str).trim().split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    return parts.reduce(function (acc, p) { return acc * 60 + p; }, 0);
  }

  // "0:00 Intro; 1:30 Setup; 4:05 Deploy"  (semicolons or new lines)
  function parseChapters(str) {
    if (!str) return [];
    return String(str).split(/[;\n]/).map(function (line) {
      var m = line.trim().match(/^(\d+(?::\d{1,2}){0,2})\s*[-–—|]?\s*(.+)$/);
      return m ? { time: parseTime(m[1]), title: m[2].trim() } : null;
    }).filter(Boolean).sort(function (a, b) { return a.time - b.time; });
  }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ *
   * Icons
   * ------------------------------------------------------------------ */

  function svg(body) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>'; }
  function p(d) { return svg('<path d="' + d + '"/>'); }

  var I = {
    play: p('M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z'),
    pause: p('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    replay: p('M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z'),
    back: svg('<path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="15.6" font-size="6.4" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">10</text>'),
    fwd: svg('<path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="15.6" font-size="6.4" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">10</text>'),
    volHigh: p('M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z'),
    volLow: p('M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12z'),
    mute: p('M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z'),
    fs: p('M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'),
    fsExit: p('M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'),
    gear: p('M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z'),
    pip: p('M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z'),
    close: p('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
    minimize: p('M6 17h12v2H6z'),
    restore: p('M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H6V6h12v12z'),
    grow: p('M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z'),
    shrink: p('M22 3.41 16.71 8.7 20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM3.41 22l5.29-5.29L12 20v-8H4l3.29 3.29L2 20.59 3.41 22z'),
    right: p('M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z'),
    left: p('M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z'),
    check: p('M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'),
    ext: p('M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'),
    kbd: p('M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z'),
    list: p('M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z')
  };

  /* ------------------------------------------------------------------ *
   * Styles (scoped inside the shadow root)
   * ------------------------------------------------------------------ */

  var CSS = [
    ':host{--dp-accent:#4f7cff;--dp-radius:14px;--dp-width:380px;--dp-gap:20px;display:block;position:relative;color:#fff;',
    'font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-tap-highlight-color:transparent}',
    ':host([hidden]){display:none!important}',
    '*,*::before,*::after{box-sizing:border-box}',
    'button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer}',
    'button:focus-visible,input:focus-visible,.player:focus-visible{outline:2px solid var(--dp-accent);outline-offset:2px}',
    '[hidden]{display:none!important}',
    'svg{width:22px;height:22px;fill:currentColor;display:block}',

    /* frame + header */
    '.frame{position:relative;background:#0b0d12;border-radius:var(--dp-radius);overflow:hidden}',
    '.header{display:none;align-items:center;gap:4px;padding:6px 6px 6px 14px;background:#151924;user-select:none;-webkit-user-select:none;touch-action:none}',
    ':host([mode=floating]) .header,:host([mode=modal]) .header,:host([closable]) .header{display:flex}',
    ':host([mode=floating]) .header{cursor:grab}',
    ':host([mode=floating]) .header:active{cursor:grabbing}',
    '.header .title{flex:1;min-width:0;font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.header .dot{width:8px;height:8px;border-radius:50%;background:var(--dp-accent);flex:none;margin-right:6px}',
    '.hbtn{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;color:#c9d0e0;flex:none}',
    '.hbtn:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.hbtn svg{width:18px;height:18px}',
    ':host(:not([mode=floating])) .fl-only{display:none}',
    '.frame.minimized .player{display:none}',

    /* player surface */
    '.player{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden;outline:none;container-type:inline-size}',
    '.player:fullscreen{aspect-ratio:auto;width:100%;height:100%}',
    '.player:-webkit-full-screen{aspect-ratio:auto;width:100%;height:100%}',
    'video,iframe,.poster{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}',
    'video{object-fit:contain}',
    '.poster{object-fit:cover;pointer-events:none;transition:opacity .3s}',
    '.player.started .poster{opacity:0}',
    '.surface{position:absolute;inset:0}',
    '.player.iframe .surface,.player.iframe .controls,.player.iframe .big,.player.iframe .poster,.player.iframe .spinner,.player.iframe .titlebar{display:none}',

    /* inline title */
    '.titlebar{position:absolute;left:0;right:0;top:0;padding:12px 14px 28px;background:linear-gradient(rgba(0,0,0,.65),transparent);font-weight:600;font-size:15px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transition:opacity .25s}',
    ':host([mode=floating]) .titlebar,:host([mode=modal]) .titlebar,:host([closable]) .titlebar{display:none}',
    '.player.started.idle .titlebar,.player.started.playing:not(:hover) .titlebar{opacity:0}',

    /* big play */
    '.big{position:absolute;left:50%;top:50%;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;background:var(--dp-accent);display:grid;place-items:center;',
    'box-shadow:0 8px 30px rgba(0,0,0,.45);transition:transform .15s,opacity .2s}',
    '.big:hover{transform:scale(1.07)}',
    '.big svg{width:34px;height:34px}',
    '.player.playing .big,.player.waiting .big{opacity:0;pointer-events:none;transform:scale(.8)}',
    '@container (max-width:420px){.big{width:58px;height:58px;margin:-29px 0 0 -29px}.big svg{width:28px;height:28px}}',

    /* spinner */
    '.spinner{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:4px solid rgba(255,255,255,.2);',
    'border-top-color:#fff;animation:dp-spin .8s linear infinite;display:none;pointer-events:none}',
    '.player.waiting .spinner{display:block}',
    '@keyframes dp-spin{to{transform:rotate(360deg)}}',

    /* toast + seek ripples */
    '.toast{position:absolute;left:50%;top:18%;transform:translateX(-50%);background:rgba(10,12,18,.82);padding:7px 14px;border-radius:999px;font-weight:600;font-size:13px;',
    'pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis}',
    '.toast.show{opacity:1}',
    '.ripple{position:absolute;top:0;bottom:0;width:38%;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .35s;font-weight:700}',
    '.ripple.l{left:0;border-radius:0 50% 50% 0;background:radial-gradient(circle at 30% 50%,rgba(255,255,255,.18),transparent 70%)}',
    '.ripple.r{right:0;border-radius:50% 0 0 50%;background:radial-gradient(circle at 70% 50%,rgba(255,255,255,.18),transparent 70%)}',
    '.ripple.show{opacity:1;transition:none}',

    /* controls */
    '.controls{position:absolute;left:0;right:0;bottom:0;padding:30px 10px 6px;background:linear-gradient(transparent,rgba(0,0,0,.8));transition:opacity .25s}',
    '.player.idle .controls{opacity:0;pointer-events:none}',
    '.player.idle{cursor:none}',
    '.progress{position:relative;height:18px;display:flex;align-items:center;cursor:pointer;touch-action:none;margin:0 6px}',
    '.track{position:relative;height:4px;width:100%;background:rgba(255,255,255,.25);border-radius:4px;transition:height .12s}',
    '.progress:hover .track,.progress.drag .track{height:6px}',
    '.buffered,.played{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;width:0}',
    '.buffered{background:rgba(255,255,255,.35)}',
    '.played{background:var(--dp-accent)}',
    '.marker{position:absolute;top:0;bottom:0;width:3px;margin-left:-1px;background:rgba(0,0,0,.7)}',
    '.knob{position:absolute;top:50%;left:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;transform:scale(0);transition:transform .12s;box-shadow:0 1px 4px rgba(0,0,0,.5)}',
    '.progress:hover .knob,.progress.drag .knob,.progress:focus-visible .knob{transform:scale(1)}',
    '.tip{position:absolute;bottom:24px;left:0;transform:translateX(-50%);background:rgba(15,18,26,.95);padding:5px 9px;border-radius:7px;font-size:12px;',
    'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .1s;text-align:center;font-variant-numeric:tabular-nums}',
    '.tip b{display:block;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis}',
    '.progress:hover .tip,.progress.drag .tip{opacity:1}',
    '.bar{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden}',
    '.btn{width:38px;height:38px;display:grid;place-items:center;border-radius:9px;flex:none;position:relative}',
    '.btn:hover{background:rgba(255,255,255,.12)}',
    '.btn.on::after{content:"";position:absolute;bottom:5px;left:50%;width:14px;height:2px;margin-left:-7px;border-radius:2px;background:var(--dp-accent)}',
    '.vol{display:flex;align-items:center;flex:none}',
    '.vol input{width:0;opacity:0;transition:width .2s,opacity .2s;accent-color:var(--dp-accent);cursor:pointer;margin:0}',
    '.vol:hover input,.vol:focus-within input{width:76px;opacity:1;margin:0 6px 0 2px}',
    '.time{font-variant-numeric:tabular-nums;font-size:13px;padding:0 8px;white-space:nowrap;flex:none;opacity:.95}',
    '.chap{flex:1;min-width:0;font-size:13px;color:#c9d0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;padding:4px 6px;border-radius:6px}',
    '.chap:hover{color:#fff}',
    '.speed{width:auto;min-width:38px;padding:0 6px;font-size:13px;font-weight:700}',
    '@container (max-width:520px){.hide-sm{display:none}.vol:hover input,.vol:focus-within input{width:56px}}',
    '@container (max-width:380px){.hide-xs{display:none}.time{padding:0 4px;font-size:12px}.btn{width:34px;height:34px}}',

    /* menu */
    '.menu{position:absolute;right:10px;bottom:62px;width:250px;max-width:calc(100% - 20px);max-height:calc(100% - 74px);overflow:auto;background:rgba(18,21,30,.97);',
    'border-radius:12px;padding:6px;box-shadow:0 12px 40px rgba(0,0,0,.5);display:none;font-size:13.5px;overscroll-behavior:contain}',
    '.menu.open{display:block}',
    '.item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:8px;text-align:left}',
    '.item:hover,.item:focus-visible{background:rgba(255,255,255,.08)}',
    '.item svg{width:18px;height:18px;flex:none;opacity:.85}',
    '.item .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.item .val{color:#9aa4bb;flex:none}',
    '.item .ck{width:18px;flex:none}',
    '.item.sel{color:var(--dp-accent);font-weight:600}',
    '.mhead{display:flex;align-items:center;gap:6px;padding:6px 6px 8px;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:600}',
    '.mhead button{width:28px;height:28px;display:grid;place-items:center;border-radius:7px}',
    '.mhead button:hover{background:rgba(255,255,255,.08)}',
    '.switch{width:32px;height:18px;border-radius:9px;background:rgba(255,255,255,.25);position:relative;flex:none;transition:background .15s}',
    '.switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s}',
    '.switch.on{background:var(--dp-accent)}',
    '.switch.on::after{transform:translateX(14px)}',

    /* overlays */
    '.overlay{position:absolute;inset:0;background:rgba(8,10,15,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;overflow:auto}',
    '.overlay h3{margin:0;font-size:16px}',
    '.overlay p{margin:0;color:#b8c0d2;max-width:440px;font-size:13.5px}',
    '.pill{background:var(--dp-accent);color:#fff;padding:8px 14px;border-radius:999px;font-weight:600;font-size:13px}',
    '.pill.ghost{background:rgba(255,255,255,.12)}',
    '.row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}',
    '.keys{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;text-align:left;font-size:13px;color:#d6dbe7}',
    '.keys kbd{font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,.12);padding:2px 7px;border-radius:5px;justify-self:end;white-space:nowrap}',

    /* floating widget */
    ':host([mode=floating]){position:fixed;z-index:2147483000;width:var(--dp-width);max-width:calc(100vw - 24px)}',
    ':host([mode=floating][size=large]){--dp-width:min(720px,calc(100vw - 24px))}',
    ':host([mode=floating]) .frame{box-shadow:0 18px 50px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.06);animation:dp-pop .25s ease-out}',
    ':host([mode=floating].closed) .frame{display:none}',
    ':host([mode=floating]:not(.closed)) .launcher{display:none}',
    '@keyframes dp-pop{from{opacity:0;transform:translateY(12px) scale(.98)}}',
    '.launcher{display:none;align-items:center;gap:8px;background:#151924;color:#fff;padding:10px 16px 10px 10px;border-radius:999px;font-weight:600;font-size:13.5px;',
    'box-shadow:0 10px 30px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.08);animation:dp-pop .25s ease-out;max-width:100%}',
    ':host([mode=floating].closed) .launcher{display:inline-flex}',
    ':host([mode=floating].closed){width:auto}',
    ':host([mode=floating].closed.right){text-align:right}',
    '.launcher .ic{width:28px;height:28px;border-radius:50%;background:var(--dp-accent);display:grid;place-items:center;flex:none}',
    '.launcher .ic svg{width:16px;height:16px}',
    '.launcher .lt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.launcher:hover{background:#1d2230}',

    /* modal */
    ':host([mode=modal]){position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,15,.75);',
    '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}',
    ':host([mode=modal][open]){display:flex}',
    ':host([mode=modal]) .frame{width:min(1040px,100%,calc((100vh - 90px) * 16 / 9));box-shadow:0 30px 80px rgba(0,0,0,.5);animation:dp-pop .2s ease-out}',

    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
  ].join('\n');

  var TEMPLATE = [
    '<div class="frame" part="frame">',
    '  <div class="header" part="header">',
    '    <span class="dot"></span><span class="title"></span>',
    '    <button class="hbtn fl-only" data-a="minimize" aria-label="Minimize">' + I.minimize + '</button>',
    '    <button class="hbtn fl-only" data-a="size" aria-label="Make larger">' + I.grow + '</button>',
    '    <button class="hbtn" data-a="close" aria-label="Close video">' + I.close + '</button>',
    '  </div>',
    '  <div class="player" tabindex="0" role="region" aria-label="Video player">',
    '    <video playsinline preload="none"></video>',
    '    <iframe hidden title="Google Drive video" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>',
    '    <img class="poster" alt="" hidden>',
    '    <div class="surface"></div>',
    '    <div class="ripple l"></div><div class="ripple r"></div>',
    '    <div class="titlebar" hidden></div>',
    '    <div class="spinner"></div>',
    '    <button class="big" data-a="play" aria-label="Play">' + I.play + '</button>',
    '    <div class="toast" role="status" aria-live="polite"></div>',
    '    <div class="controls">',
    '      <div class="progress" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">',
    '        <div class="track"><div class="buffered"></div><div class="played"></div><div class="markers"></div></div>',
    '        <div class="knob"></div><div class="tip"></div>',
    '      </div>',
    '      <div class="bar">',
    '        <button class="btn" data-a="play" aria-label="Play (k)">' + I.play + '</button>',
    '        <button class="btn hide-xs" data-a="back" aria-label="Back 10 seconds (j)">' + I.back + '</button>',
    '        <button class="btn hide-xs" data-a="fwd" aria-label="Forward 10 seconds (l)">' + I.fwd + '</button>',
    '        <div class="vol"><button class="btn" data-a="mute" aria-label="Mute (m)">' + I.volHigh + '</button>',
    '          <input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></div>',
    '        <span class="time">0:00 / 0:00</span>',
    '        <button class="chap hide-sm" data-a="chapters" hidden></button>',
    '        <span class="spacer" style="flex:1"></span>',
    '        <button class="btn speed hide-xs" data-a="speedmenu" aria-label="Playback speed">1×</button>',
    '        <button class="btn" data-a="settings" aria-label="Settings" aria-haspopup="true">' + I.gear + '</button>',
    '        <button class="btn hide-sm" data-a="pip" aria-label="Picture in picture (p)">' + I.pip + '</button>',
    '        <button class="btn" data-a="fullscreen" aria-label="Full screen (f)">' + I.fs + '</button>',
    '      </div>',
    '    </div>',
    '    <div class="menu" role="menu"></div>',
    '    <div class="overlay help" hidden></div>',
    '    <div class="overlay err" hidden></div>',
    '  </div>',
    '</div>',
    '<button class="launcher" data-a="open"><span class="ic">' + I.play + '</span><span class="lt"></span></button>'
  ].join('\n');

  var SHORTCUTS = [
    ['Space / K', 'Play / pause'],
    ['← / J', 'Back 5s / 10s'],
    ['→ / L', 'Forward 5s / 10s'],
    ['↑ / ↓', 'Volume up / down'],
    ['M', 'Mute'],
    ['F', 'Full screen'],
    ['P', 'Picture in picture'],
    ['Shift + > / <', 'Faster / slower'],
    ['0 – 9', 'Jump to 0% – 90%'],
    ['Home / End', 'Start / end'],
    [', / .', 'Prev / next chapter'],
    ['?', 'Show shortcuts'],
    ['Esc', 'Close menu / player']
  ];

  /* ------------------------------------------------------------------ *
   * <drive-player>
   * ------------------------------------------------------------------ */

  class DrivePlayer extends HTMLElement {
    static get observedAttributes() {
      return ['src', 'title', 'heading', 'chapters', 'mode', 'position', 'poster', 'api-key'];
    }
  }

  var proto = DrivePlayer.prototype;

  proto.connectedCallback = function () {
    if (!this._ready) this._build();
    document.addEventListener('fullscreenchange', this._onFs);
    document.addEventListener('webkitfullscreenchange', this._onFs);
    this._applyMode();
    if (!this._loadedOnce) { this._loadedOnce = true; this._load(); }
  };

  proto.disconnectedCallback = function () {
    this._saveResume();
    clearTimeout(this._stallTimer);
    clearTimeout(this._idleTimer);
    document.removeEventListener('fullscreenchange', this._onFs);
    document.removeEventListener('webkitfullscreenchange', this._onFs);
  };

  proto.attributeChangedCallback = function (name, oldV, newV) {
    if (name === 'title' && newV != null) {
      // Keep the native tooltip from covering the whole player.
      this.removeAttribute('title');
      this.setAttribute('heading', newV);
      return;
    }
    if (!this._ready || oldV === newV) return;
    if (name === 'src' || name === 'api-key') this._load();
    else if (name === 'heading') this._renderHeading();
    else if (name === 'chapters') this._renderChapters();
    else if (name === 'poster') this._renderPoster();
    else if (name === 'mode' || name === 'position') this._applyMode();
  };

  /* ---------- build & wire ---------- */

  proto._build = function () {
    var self = this;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = '<style>' + CSS + '</style>' + TEMPLATE;
    }
    var $ = function (s) { return self.shadowRoot.querySelector(s); };
    this.$ = $;
    this.els = {
      frame: $('.frame'), header: $('.header'), title: $('.header .title'), player: $('.player'),
      video: $('video'), iframe: $('iframe'), poster: $('.poster'), surface: $('.surface'),
      titlebar: $('.titlebar'), toast: $('.toast'), progress: $('.progress'), played: $('.played'),
      buffered: $('.buffered'), knob: $('.knob'), tip: $('.tip'), markers: $('.markers'),
      time: $('.time'), chap: $('.chap'), vol: $('.vol input'), speed: $('.speed'),
      menu: $('.menu'), help: $('.help'), err: $('.err'), launcher: $('.launcher'),
      launcherText: $('.launcher .lt'), rl: $('.ripple.l'), rr: $('.ripple.r')
    };
    this._ready = true;
    var v = this.els.video;

    if (this.hasAttribute('muted')) v.muted = true;
    if (this.hasAttribute('loop')) v.loop = true;
    var savedVol = parseFloat(store.get('dp-volume'));
    if (!isNaN(savedVol)) v.volume = savedVol;

    // Buttons (event delegation)
    this.shadowRoot.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      e.stopPropagation();
      self._action(b.getAttribute('data-a'), b);
    });

    // Video events
    var on = function (ev, fn) { v.addEventListener(ev, fn); };
    on('play', function () { self._state(); self._emit('play'); });
    on('pause', function () { self._state(); self._saveResume(); self._emit('pause'); });
    on('playing', function () { self.els.player.classList.remove('waiting'); self._state(); });
    on('waiting', function () { self.els.player.classList.add('waiting'); });
    on('canplay', function () { self.els.player.classList.remove('waiting'); });
    on('timeupdate', function () { self._time(); self._throttledSave(); });
    on('progress', function () { self._buffer(); });
    on('durationchange', function () { self._time(); self._renderChapters(); });
    on('volumechange', function () { self._volume(); });
    on('ratechange', function () { self._rate(); });
    on('ended', function () { self._state(); store.del(self._resumeKey()); self._emit('ended'); self._wake(); });
    on('loadedmetadata', function () { self._onMeta(); });
    on('error', function () { self._onSourceError(); });
    on('enterpictureinpicture', function () { self._pipBtn(); });
    on('leavepictureinpicture', function () { self._pipBtn(); });

    // Surface: click = play/pause, dblclick = fullscreen, touch double-tap = seek
    this._wireSurface();
    this._wireProgress();
    this._wireDrag();

    this.els.vol.addEventListener('input', function () {
      v.volume = parseFloat(self.els.vol.value);
      v.muted = v.volume === 0;
    });

    // Keyboard
    this.els.frame.addEventListener('keydown', function (e) { self._key(e); });
    this.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self._mode() === 'modal' && self.hasAttribute('open')) { e.preventDefault(); self.close(); }
    });

    // Activity → show controls
    ['pointermove', 'pointerdown', 'focusin'].forEach(function (ev) {
      self.els.player.addEventListener(ev, function () { self._wake(); });
    });
    this.els.player.addEventListener('pointerleave', function () {
      if (!v.paused && !self.els.menu.classList.contains('open')) self.els.player.classList.add('idle');
    });

    // Close menu on outside click
    this.els.player.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.menu') && !e.target.closest('[data-a=settings]') && !e.target.closest('[data-a=speedmenu]') && !e.target.closest('[data-a=chapters]')) self._closeMenu();
    });

    // Modal: click on backdrop closes
    this.addEventListener('click', function (e) {
      if (self._mode() === 'modal' && e.composedPath()[0] === self) self.close();
    });

    this._onFs = function () { self._fsBtn(); };

    this.els.poster.addEventListener('error', function () { self.els.poster.hidden = true; });

    var pipOk = document.pictureInPictureEnabled && !v.disablePictureInPicture;
    if (!pipOk || this.hasAttribute('no-pip')) this.$('[data-a=pip]').hidden = true;
    if (!this._canFullscreen()) this.$('[data-a=fullscreen]').hidden = true;

    this._renderHeading();
    this._renderChapters();
    this._volume();
    this._rate();
    this._state();
  };

  proto._wireSurface = function () {
    var self = this, s = this.els.surface, lastTap = 0, tapTimer = null;
    s.addEventListener('pointerup', function (e) {
      if (e.button) return;
      self._lastPointer = e.pointerType;
      if (self.els.menu.classList.contains('open')) { self._closeMenu(); return; }
      if (e.pointerType === 'mouse') { self.toggle(); return; }
      // Touch: single tap toggles controls, double tap on a side seeks.
      var now = Date.now(), rect = s.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width;
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        lastTap = 0;
        if (x < 0.35) self._seekBy(-10, 'l');
        else if (x > 0.65) self._seekBy(10, 'r');
        else self.toggleFullscreen();
        return;
      }
      lastTap = now;
      tapTimer = setTimeout(function () {
        var p = self.els.player;
        if (!self._started) self.play();
        else if (p.classList.contains('idle')) self._wake();
        else if (!self.els.video.paused) p.classList.add('idle');
      }, 260);
    });
    // Mouse double-click: the two single clicks already cancel each other out.
    s.addEventListener('dblclick', function () {
      if (self._lastPointer === 'mouse') self.toggleFullscreen();
    });
  };

  proto._wireProgress = function () {
    var self = this, pr = this.els.progress, dragging = false, wasPlaying = false;
    var frac = function (e) {
      var r = pr.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    var tip = function (f) {
      var d = self.els.video.duration;
      if (!isFinite(d) || !d) { self.els.tip.style.opacity = 0; return; }
      self.els.tip.style.opacity = '';
      var t = f * d, ch = self._chapterAt(t);
      self.els.tip.innerHTML = (ch ? '<b>' + esc(ch.title) + '</b>' : '') + fmt(t);
      var w = pr.clientWidth, tw = self.els.tip.offsetWidth / 2;
      self.els.tip.style.left = Math.min(w - tw + 6, Math.max(tw - 6, f * w)) + 'px';
    };
    pr.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      self._ensureSource();
      var d = self.els.video.duration;
      if (!isFinite(d) || !d) return;
      dragging = true;
      wasPlaying = !self.els.video.paused;
      pr.classList.add('drag');
      try { pr.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      self._scrub(frac(e));
      tip(frac(e));
    });
    pr.addEventListener('pointermove', function (e) {
      tip(frac(e));
      if (dragging) self._scrub(frac(e));
    });
    var end = function () {
      if (!dragging) return;
      dragging = false;
      pr.classList.remove('drag');
      if (wasPlaying) self.play();
    };
    pr.addEventListener('pointerup', end);
    pr.addEventListener('pointercancel', end);
    pr.addEventListener('keydown', function (e) {
      var v = self.els.video;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        self._seekBy(e.key === 'ArrowLeft' ? -5 : 5);
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault(); e.stopPropagation();
        self._seekBy(e.key === 'PageDown' ? -60 : 60);
      } else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); self.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); self.seek(v.duration || 0); }
    });
  };

  proto._scrub = function (f) {
    var v = this.els.video;
    v.currentTime = f * v.duration;
    this._time();
  };

  // Floating mode: drag the header anywhere, it snaps to the nearest corner.
  proto._wireDrag = function () {
    var self = this, h = this.els.header, start = null;
    h.addEventListener('pointerdown', function (e) {
      if (self._mode() !== 'floating' || e.button || e.target.closest('button')) return;
      var r = self.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      try { h.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    h.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      start.moved = true;
      var w = self.offsetWidth, ht = self.offsetHeight;
      var left = Math.min(window.innerWidth - w - 4, Math.max(4, start.left + dx));
      var top = Math.min(window.innerHeight - ht - 4, Math.max(4, start.top + dy));
      self.style.right = self.style.bottom = 'auto';
      self.style.left = left + 'px';
      self.style.top = top + 'px';
    });
    var end = function () {
      if (!start) return;
      var moved = start.moved;
      start = null;
      if (!moved) return;
      var r = self.getBoundingClientRect();
      var v = (r.top + r.height / 2) < window.innerHeight / 2 ? 'top' : 'bottom';
      var hz = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
      self._corner = v + '-' + hz;
      var key = self.getAttribute('dismiss-key');
      if (key) store.set('dp-corner:' + key, self._corner);
      self._positionFloating();
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('dblclick', function (e) {
      if (self._mode() === 'floating' && !e.target.closest('button')) self.minimize();
    });
  };

  /* ---------- modes ---------- */

  proto._mode = function () {
    var m = (this.getAttribute('mode') || 'inline').toLowerCase();
    return m === 'floating' || m === 'modal' ? m : 'inline';
  };

  proto._applyMode = function () {
    if (!this._ready) return;
    var mode = this._mode();
    if (mode === 'floating') {
      var key = this.getAttribute('dismiss-key');
      this._corner = (key && store.get('dp-corner:' + key)) || this.getAttribute('position') || 'bottom-right';
      this._positionFloating();
      if (key && store.get('dp-dismissed:' + key) === '1') this._setClosed(true);
      if (this.hasAttribute('start-minimized') && !this._minInit) { this._minInit = true; this.minimize(true); }
    } else {
      this.style.left = this.style.right = this.style.top = this.style.bottom = '';
      this.classList.remove('closed');
      var k = this.getAttribute('dismiss-key');
      if (mode === 'inline' && k && store.get('dp-dismissed:' + k) === '1') this.hidden = true;
    }
    if (mode === 'modal') {
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-modal', 'true');
    }
    this._renderHeading();
  };

  proto._positionFloating = function () {
    var gap = 'var(--dp-gap)';
    var c = (this._corner || 'bottom-right').split('-');
    var v = c[0] === 'top' ? 'top' : 'bottom', h = c[1] === 'left' ? 'left' : 'right';
    this.style.top = this.style.bottom = this.style.left = this.style.right = 'auto';
    this.style[v] = gap;
    this.style[h] = gap;
    this.classList.toggle('right', h === 'right');
  };

  proto._setClosed = function (closed) {
    this.classList.toggle('closed', closed);
    if (closed && this.getAttribute('launcher') === 'none') this.hidden = true;
    if (!closed) this.hidden = false;
  };

  /* ---------- public API ---------- */

  proto.play = function () {
    if (this._iframe) return Promise.resolve();
    this._wantPlay = true;
    this._ensureSource();
    var pr = this.els.video.play();
    return pr && pr.catch ? pr.catch(function () { /* autoplay blocked or source failed */ }) : Promise.resolve();
  };

  proto.pause = function () { this._wantPlay = false; this.els.video.pause(); };

  proto.toggle = function () {
    var v = this.els.video;
    if (v.paused || v.ended) this.play(); else this.pause();
  };

  proto.seek = function (t) {
    var v = this.els.video;
    this._ensureSource();
    if (!isFinite(v.duration)) { this._pendingSeek = t; return; }
    v.currentTime = Math.max(0, Math.min(v.duration, t));
    this._time();
  };

  proto.open = function () {
    var mode = this._mode();
    this._lastFocus = document.activeElement;
    if (mode === 'modal') {
      this.setAttribute('open', '');
      this.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      this.els.player.focus({ preventScroll: true });
      if (!this.hasAttribute('no-autoplay')) this.play();
    } else {
      if (mode === 'floating') this._setClosed(false);
      this.hidden = false;
      var key = this.getAttribute('dismiss-key');
      if (key) store.del('dp-dismissed:' + key);
      if (this.els.frame.classList.contains('minimized')) this.minimize(false);
      this.els.player.focus({ preventScroll: true });
    }
    if (this._iframe && this._iframeSrc) { this.els.iframe.src = this._iframeSrc; this._iframeSrc = null; }
    this._emit('open');
  };

  proto.close = function () {
    var mode = this._mode();
    this.pause();
    this._closeMenu();
    if (this._isFs()) this.toggleFullscreen();
    if (this._iframe && mode !== 'inline') {
      // Stop Drive's own player too.
      var src = this.els.iframe.src;
      this.els.iframe.src = 'about:blank';
      this._iframeSrc = src;
    }
    if (mode === 'modal') {
      this.removeAttribute('open');
      document.documentElement.style.overflow = '';
      if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus();
    } else if (mode === 'floating') {
      this._setClosed(true);
      var key = this.getAttribute('dismiss-key');
      if (key) store.set('dp-dismissed:' + key, '1');
      this.els.launcher.focus({ preventScroll: true });
    } else {
      this.hidden = true;
      var k = this.getAttribute('dismiss-key');
      if (k) store.set('dp-dismissed:' + k, '1');
    }
    this._emit('close');
  };

  proto.minimize = function (force) {
    var f = this.els.frame;
    var min = typeof force === 'boolean' ? force : !f.classList.contains('minimized');
    f.classList.toggle('minimized', min);
    var b = this.$('[data-a=minimize]');
    b.innerHTML = min ? I.restore : I.minimize;
    b.setAttribute('aria-label', min ? 'Restore' : 'Minimize');
    if (min && this.hasAttribute('pause-on-minimize')) this.pause();
  };

  proto.toggleSize = function () {
    var large = this.getAttribute('size') !== 'large';
    if (large) this.setAttribute('size', 'large'); else this.removeAttribute('size');
    var b = this.$('[data-a=size]');
    b.innerHTML = large ? I.shrink : I.grow;
    b.setAttribute('aria-label', large ? 'Make smaller' : 'Make larger');
    if (this.els.frame.classList.contains('minimized')) this.minimize(false);
  };

  proto.toggleFullscreen = function () {
    var p = this.els.player, v = this.els.video;
    if (this._isFs()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (p.requestFullscreen) {
      p.requestFullscreen().catch(function () { /* denied */ });
    } else if (p.webkitRequestFullscreen) {
      p.webkitRequestFullscreen();
    } else if (v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen(); // iOS Safari
    }
  };

  proto.togglePip = function () {
    var v = this.els.video;
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    else if (v.requestPictureInPicture) {
      this._ensureSource();
      v.requestPictureInPicture().catch(function () { /* not ready */ });
    }
  };

  proto.useDrivePlayer = function () { this._useIframe(false); };

  Object.defineProperty(proto, 'video', { get: function () { return this.els && this.els.video; } });
  Object.defineProperty(proto, 'driveId', { get: function () { return this._id || null; } });

  /* ---------- loading & fallback ---------- */

  proto._load = function () {
    var raw = (this.getAttribute('src') || '').trim();
    var v = this.els.video;
    clearTimeout(this._stallTimer);
    this._id = parseDriveId(raw);
    // Not a Drive link: treat any other URL (absolute or relative) as a plain video file.
    this._direct = !this._id && raw && !/google\.com/i.test(raw) ? raw : null;
    this._sources = this._id ? driveSources(this._id, this.getAttribute('api-key')) : (this._direct ? [this._direct] : []);
    this._srcIndex = -1;
    this._started = false;
    this._iframe = false;
    this._wantPlay = false;
    this._resumedOnce = false;
    this._pendingSeek = null;
    this.els.player.classList.remove('iframe', 'started', 'playing', 'waiting');
    this.els.iframe.hidden = true;
    this.els.iframe.removeAttribute('src');
    this.els.err.hidden = true;
    this.els.video.hidden = false;
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* ignore */ }
    this._renderPoster();
    this._renderHeading();
    this._time();

    if (!raw) return;
    if (!this._sources.length) {
      this._showError('That doesn’t look like a Google Drive link',
        'Paste a share link like https://drive.google.com/file/d/FILE_ID/view, or just the file ID.');
      return;
    }
    var engine = (this.getAttribute('engine') || '').toLowerCase();
    if (engine === 'drive' || engine === 'iframe') { this._useIframe(true); return; }
    if (this.hasAttribute('autoplay')) {
      if (this._mode() === 'modal' && !this.hasAttribute('open')) return;
      if (this._mode() === 'floating' && this.classList.contains('closed')) return;
      this.els.video.muted = this.hasAttribute('muted') || this.els.video.muted;
      this.play();
    } else if (this.getAttribute('preload') !== 'none' && (this.hasAttribute('preload') || this._direct)) {
      // Plain files are cheap to probe: show their first frame and duration right away.
      this._ensureSource('metadata');
    }
  };

  proto._ensureSource = function (preload) {
    if (this._iframe || this._srcIndex >= 0 || !this._sources || !this._sources.length) return;
    this.els.video.preload = preload || 'auto';
    this._trySource(0);
  };

  proto._trySource = function (i) {
    var self = this, v = this.els.video;
    clearTimeout(this._stallTimer);
    if (i >= this._sources.length) { this._allSourcesFailed(); return; }
    this._srcIndex = i;
    this.els.player.classList.add('waiting');
    v.src = this._sources[i];
    v.load();
    if (this._wantPlay) {
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () { /* handled by error / stall */ });
    }
    this._stallTimer = setTimeout(function () {
      if (self._srcIndex === i && v.readyState < 1) self._trySource(i + 1);
    }, STALL_MS);
  };

  proto._onSourceError = function () {
    if (this._iframe || this._srcIndex < 0) return;
    var v = this.els.video;
    if (!v.getAttribute('src')) return;
    this._trySource(this._srcIndex + 1);
  };

  proto._allSourcesFailed = function () {
    this.els.player.classList.remove('waiting');
    if (this._id && !this.hasAttribute('no-fallback')) {
      this._useIframe(false);
      this._toast('Switched to the Google Drive player');
      this._emit('fallback', { reason: 'direct-stream-unavailable' });
      return;
    }
    if (this._id) {
      this._showError('This video can’t be streamed directly',
        'Make sure the file is shared as “Anyone with the link”. Very large files may only play in the Google Drive player.', true);
    } else {
      this._showError('This video couldn’t be loaded', 'Check that the link is correct and publicly accessible.');
    }
  };

  proto._useIframe = function (initial) {
    if (!this._id) return;
    clearTimeout(this._stallTimer);
    var v = this.els.video;
    v.pause();
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* ignore */ }
    v.hidden = true;
    this._iframe = true;
    this._closeMenu();
    this.els.err.hidden = true;
    this.els.player.classList.add('iframe');
    this.els.player.classList.remove('waiting', 'idle');
    this.els.iframe.hidden = false;
    this.els.iframe.src = driveUrls.preview(this._id);
    if (!initial) this._emit('engine', { engine: 'drive' });
  };

  proto._onMeta = function () {
    clearTimeout(this._stallTimer);
    var v = this.els.video, d = v.duration;
    this.els.player.classList.remove('waiting');
    var start = parseTime(this.getAttribute('start'));
    var target = null;
    if (this._pendingSeek != null) { target = this._pendingSeek; this._pendingSeek = null; }
    else if (!this._resumedOnce) {
      this._resumedOnce = true;
      if (!isNaN(start)) target = start;
      else if (this.getAttribute('remember') !== 'false') {
        var saved = parseFloat(store.get(this._resumeKey()));
        if (saved > 5 && isFinite(d) && saved < d - 5) {
          target = saved;
          this._toast('Resuming from ' + fmt(saved));
        }
      }
    }
    if (target != null && isFinite(d)) v.currentTime = Math.min(target, d);
    this._renderChapters();
    this._time();
    this._emit('ready', { duration: d });
  };

  proto._resumeKey = function () { return 'dp-resume:' + (this._id || this._direct || ''); };

  proto._saveResume = function () {
    if (!this.els || this.getAttribute('remember') === 'false') return;
    var v = this.els.video;
    if (v.currentTime > 5 && isFinite(v.duration) && v.currentTime < v.duration - 5) store.set(this._resumeKey(), v.currentTime.toFixed(1));
  };

  proto._throttledSave = function () {
    var now = Date.now();
    if (!this._lastSave || now - this._lastSave > 4000) { this._lastSave = now; this._saveResume(); }
  };

  /* ---------- rendering ---------- */

  proto._heading = function () {
    return this.getAttribute('heading') || '';
  };

  proto._renderHeading = function () {
    if (!this._ready) return;
    var h = this._heading();
    this.els.title.textContent = h || 'Video';
    this.els.titlebar.textContent = h;
    this.els.titlebar.hidden = !h;
    this.els.launcherText.textContent = this.getAttribute('launcher') && this.getAttribute('launcher') !== 'none'
      ? this.getAttribute('launcher') : (h ? 'Watch: ' + h : 'Watch video');
    this.els.player.setAttribute('aria-label', h ? 'Video: ' + h : 'Video player');
    if (this._mode() === 'modal') this.setAttribute('aria-label', h || 'Video');
  };

  proto._renderPoster = function () {
    var img = this.els.poster, src = this.getAttribute('poster');
    if (src === 'none') { img.hidden = true; return; }
    if (!src && this._id) src = driveUrls.thumb(this._id);
    if (src) { img.hidden = false; img.src = src; } else { img.hidden = true; img.removeAttribute('src'); }
  };

  proto._renderChapters = function () {
    if (!this._ready) return;
    this._chapters = parseChapters(this.getAttribute('chapters'));
    var d = this.els.video.duration, html = '';
    if (isFinite(d) && d > 0) {
      this._chapters.forEach(function (c) {
        if (c.time > 0 && c.time < d) html += '<div class="marker" style="left:' + (c.time / d * 100) + '%"></div>';
      });
    }
    this.els.markers.innerHTML = html;
    this.els.chap.hidden = !this._chapters.length;
    this._chapLabel();
  };

  proto._chapterAt = function (t) {
    var c = this._chapters || [], cur = null;
    for (var i = 0; i < c.length; i++) { if (c[i].time <= t + 0.25) cur = c[i]; else break; }
    return cur;
  };

  proto._chapLabel = function () {
    if (!this._chapters || !this._chapters.length) return;
    var c = this._chapterAt(this.els.video.currentTime || 0);
    var txt = c ? '• ' + c.title : '• Chapters';
    if (this.els.chap.textContent !== txt) this.els.chap.textContent = txt;
  };

  proto._state = function () {
    var v = this.els.video, p = this.els.player, playing = !v.paused && !v.ended;
    if (playing || v.currentTime > 0) { this._started = true; p.classList.add('started'); }
    p.classList.toggle('playing', playing);
    var icon = v.ended ? I.replay : playing ? I.pause : I.play;
    var label = v.ended ? 'Replay' : playing ? 'Pause (k)' : 'Play (k)';
    this.shadowRoot.querySelectorAll('[data-a=play]').forEach(function (b) {
      b.innerHTML = icon;
      b.setAttribute('aria-label', label);
    });
    if (!playing) this._wake(true);
    else this._wake();
  };

  proto._time = function () {
    var v = this.els.video, d = v.duration, t = v.currentTime || 0;
    var f = isFinite(d) && d > 0 ? t / d : 0;
    this.els.played.style.width = (f * 100) + '%';
    this.els.knob.style.left = (f * 100) + '%';
    this.els.time.textContent = fmt(t) + ' / ' + (isFinite(d) ? fmt(d) : '0:00');
    this.els.progress.setAttribute('aria-valuemax', isFinite(d) ? Math.floor(d) : 0);
    this.els.progress.setAttribute('aria-valuenow', Math.floor(t));
    this.els.progress.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d));
    this._chapLabel();
  };

  proto._buffer = function () {
    var v = this.els.video, d = v.duration, b = v.buffered;
    if (!isFinite(d) || !d || !b.length) return;
    var end = 0;
    for (var i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5) end = Math.max(end, b.end(i));
    this.els.buffered.style.width = (end / d * 100) + '%';
  };

  proto._volume = function () {
    var v = this.els.video, level = v.muted ? 0 : v.volume;
    this.els.vol.value = level;
    var b = this.$('[data-a=mute]');
    b.innerHTML = level === 0 ? I.mute : level < 0.5 ? I.volLow : I.volHigh;
    b.setAttribute('aria-label', level === 0 ? 'Unmute (m)' : 'Mute (m)');
    if (!v.muted && v.volume > 0) store.set('dp-volume', String(v.volume));
  };

  proto._rate = function () {
    var r = this.els.video.playbackRate;
    this.els.speed.textContent = r + '×';
    this.els.speed.classList.toggle('on', r !== 1);
  };

  proto._fsBtn = function () {
    var b = this.$('[data-a=fullscreen]'), fs = this._isFs();
    b.innerHTML = fs ? I.fsExit : I.fs;
    b.setAttribute('aria-label', fs ? 'Exit full screen (f)' : 'Full screen (f)');
  };

  proto._pipBtn = function () {
    this.$('[data-a=pip]').classList.toggle('on', document.pictureInPictureElement === this.els.video);
  };

  proto._isFs = function () {
    var sr = this.shadowRoot;
    return !!(sr.fullscreenElement || sr.webkitFullscreenElement ||
      (document.fullscreenElement === this) || (document.webkitFullscreenElement === this));
  };

  proto._canFullscreen = function () {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || this.els.video.webkitEnterFullscreen);
  };

  proto._wake = function (stay) {
    var self = this, p = this.els.player;
    p.classList.remove('idle');
    clearTimeout(this._idleTimer);
    if (stay) return;
    this._idleTimer = setTimeout(function () {
      var v = self.els.video;
      if (!v.paused && !self.els.menu.classList.contains('open') && !self.els.progress.classList.contains('drag')) p.classList.add('idle');
    }, 2600);
  };

  proto._toast = function (msg) {
    var t = this.els.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1300);
  };

  proto._seekBy = function (s, side) {
    var v = this.els.video;
    if (!isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + s));
    this._time();
    if (side) {
      var el = side === 'l' ? this.els.rl : this.els.rr;
      el.textContent = (s > 0 ? '+' : '−') + Math.abs(s) + 's';
      el.classList.add('show');
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.classList.remove('show'); }, 450);
    } else {
      this._toast((s > 0 ? '+' : '−') + Math.abs(s) + 's');
    }
  };

  proto._setRate = function (r) {
    r = Math.min(4, Math.max(0.25, Math.round(r * 100) / 100));
    this.els.video.playbackRate = r;
    this._toast(r + '× speed');
  };

  proto._showError = function (title, msg, offerDrive) {
    var e = this.els.err;
    var btns = '';
    if (offerDrive && this._id) btns += '<button class="pill" data-a="drive">Use Google Drive player</button>';
    if (this._id) btns += '<a class="pill ghost" style="color:#fff;text-decoration:none" target="_blank" rel="noopener" href="' + driveUrls.view(this._id) + '">Open in Google Drive</a>';
    e.innerHTML = '<h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p>' + (btns ? '<div class="row">' + btns + '</div>' : '');
    e.hidden = false;
    this._emit('error', { message: title });
  };

  proto._emit = function (name, detail) {
    this.dispatchEvent(new CustomEvent('dp:' + name, { detail: detail || {}, bubbles: true, composed: true }));
  };

  /* ---------- actions & menus ---------- */

  proto._action = function (a, btn) {
    var v = this.els.video;
    switch (a) {
      case 'play': this.toggle(); break;
      case 'back': this._seekBy(-10); break;
      case 'fwd': this._seekBy(10); break;
      case 'mute':
        if (v.muted || v.volume === 0) { v.muted = false; if (v.volume === 0) v.volume = 0.6; } else v.muted = true;
        break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'pip': this.togglePip(); break;
      case 'settings': this._toggleMenu('main'); break;
      case 'speedmenu': this._toggleMenu('speed'); break;
      case 'chapters': this._toggleMenu('chapters'); break;
      case 'menu': this._renderMenu(btn.getAttribute('data-v')); break;
      case 'rate': this._setRate(parseFloat(btn.getAttribute('data-v'))); this._renderMenu('speed'); break;
      case 'loop': v.loop = !v.loop; this._toast(v.loop ? 'Loop on' : 'Loop off'); this._renderMenu('main'); break;
      case 'fit':
        v.style.objectFit = v.style.objectFit === 'cover' ? 'contain' : 'cover';
        this._toast(v.style.objectFit === 'cover' ? 'Fill frame' : 'Fit to frame');
        this._renderMenu('main');
        break;
      case 'jump': this.seek(parseFloat(btn.getAttribute('data-v'))); this._closeMenu(); if (v.paused) this.play(); break;
      case 'help': this._closeMenu(); this._help(true); break;
      case 'help-close': this._help(false); break;
      case 'drive': this._closeMenu(); this.useDrivePlayer(); break;
      case 'native':
        this._closeMenu();
        this._iframe = false;
        this.els.iframe.hidden = true;
        this.els.iframe.removeAttribute('src');
        this.els.player.classList.remove('iframe');
        this.els.video.hidden = false;
        this._srcIndex = -1;
        this.play();
        break;
      case 'close': this.close(); break;
      case 'open': this.open(); break;
      case 'minimize': this.minimize(); break;
      case 'size': this.toggleSize(); break;
    }
  };

  proto._toggleMenu = function (view) {
    var m = this.els.menu;
    if (m.classList.contains('open') && this._menuView === view) { this._closeMenu(); return; }
    this._renderMenu(view);
    m.classList.add('open');
    this._wake(true);
    var first = m.querySelector('.item.sel') || m.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  };

  proto._closeMenu = function () {
    if (!this.els.menu.classList.contains('open')) return;
    this.els.menu.classList.remove('open');
    this._wake();
  };

  proto._renderMenu = function (view) {
    var v = this.els.video, html = '', self = this;
    this._menuView = view;
    var head = function (t) {
      return '<div class="mhead"><button data-a="menu" data-v="main" aria-label="Back">' + I.left + '</button>' + t + '</div>';
    };
    if (view === 'speed') {
      html += head('Playback speed');
      SPEEDS.forEach(function (s) {
        var sel = v.playbackRate === s;
        html += '<button class="item' + (sel ? ' sel' : '') + '" role="menuitemradio" aria-checked="' + sel + '" data-a="rate" data-v="' + s + '">' +
          '<span class="ck">' + (sel ? I.check : '') + '</span><span class="lbl">' + (s === 1 ? 'Normal' : s + '×') + '</span></button>';
      });
    } else if (view === 'chapters') {
      html += head('Chapters');
      var cur = this._chapterAt(v.currentTime || 0);
      (this._chapters || []).forEach(function (c) {
        var sel = c === cur;
        html += '<button class="item' + (sel ? ' sel' : '') + '" role="menuitem" data-a="jump" data-v="' + c.time + '">' +
          '<span class="val" style="min-width:42px">' + fmt(c.time) + '</span><span class="lbl">' + esc(c.title) + '</span></button>';
      });
    } else {
      var row = function (a, icon, label, val, extra) {
        return '<button class="item" role="menuitem" data-a="' + a + '"' + (extra || '') + '>' + icon + '<span class="lbl">' + label + '</span>' + (val || '') + '</button>';
      };
      var sw = function (on) { return '<span class="switch' + (on ? ' on' : '') + '"></span>'; };
      html += row('menu', svg('<path d="M10 8v8l6-4-6-4zm2-6a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/>'), 'Playback speed',
        '<span class="val">' + (v.playbackRate === 1 ? 'Normal' : v.playbackRate + '×') + '</span>' + I.right, ' data-v="speed"');
      if (this._chapters && this._chapters.length) html += row('menu', I.list, 'Chapters', '<span class="val">' + this._chapters.length + '</span>' + I.right, ' data-v="chapters"');
      html += row('loop', I.replay, 'Loop video', sw(v.loop));
      html += row('fit', I.fs, 'Fill frame (crop)', sw(v.style.objectFit === 'cover'));
      if (!this.$('[data-a=pip]').hidden) html += row('pip', I.pip, 'Picture in picture');
      html += row('help', I.kbd, 'Keyboard shortcuts');
      if (this._id) {
        html += row('drive', svg('<path d="M7.71 3.5 1.15 15l3.43 6 6.55-11.5L7.71 3.5zm1.73 0 6.56 11.5h6.85L16.29 3.5H9.44zM9.87 16 6.44 22h13.13l3.43-6H9.87z"/>'), 'Use Google Drive player');
        html += '<a class="item" role="menuitem" style="color:inherit;text-decoration:none" target="_blank" rel="noopener" href="' + driveUrls.view(this._id) + '">' + I.ext + '<span class="lbl">Open in Google Drive</span></a>';
      }
    }
    this.els.menu.innerHTML = html;
    if (self.els.menu.classList.contains('open')) {
      var f = self.els.menu.querySelector('.item.sel') || self.els.menu.querySelector('button');
      if (f) f.focus({ preventScroll: true });
    }
  };

  proto._help = function (show) {
    var h = this.els.help;
    if (!show) { h.hidden = true; this.els.player.focus({ preventScroll: true }); return; }
    var rows = SHORTCUTS.map(function (s) { return '<kbd>' + s[0] + '</kbd><span>' + s[1] + '</span>'; }).join('');
    h.innerHTML = '<h3>Keyboard shortcuts</h3><div class="keys">' + rows + '</div><button class="pill" data-a="help-close">Got it</button>';
    h.hidden = false;
    h.querySelector('button').focus({ preventScroll: true });
  };

  proto._key = function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.composedPath()[0] || {}).tagName;
    if (tag === 'INPUT' && e.key !== 'Escape') return;
    var v = this.els.video, k = e.key, handled = true;

    if (k === 'Escape') {
      if (!this.els.help.hidden) this._help(false);
      else if (this.els.menu.classList.contains('open')) { this._closeMenu(); this.els.player.focus({ preventScroll: true }); }
      else if (this._mode() !== 'inline' && !this._isFs()) this.close();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (this._iframe) return;
    // Let buttons/menu items handle their own Enter/Space.
    if ((k === ' ' || k === 'Enter') && tag === 'BUTTON') return;
    if (this.els.menu.classList.contains('open') && (k === 'ArrowUp' || k === 'ArrowDown')) {
      var items = [].slice.call(this.els.menu.querySelectorAll('button,a'));
      var i = items.indexOf(this.shadowRoot.activeElement);
      var n = items[(i + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (n) n.focus();
      e.preventDefault();
      return;
    }

    switch (k) {
      case ' ': case 'k': case 'K': this.toggle(); this._toast(v.paused ? 'Paused' : 'Playing'); break;
      case 'ArrowLeft': this._seekBy(-5); break;
      case 'ArrowRight': this._seekBy(5); break;
      case 'j': case 'J': this._seekBy(-10); break;
      case 'l': case 'L': this._seekBy(10); break;
      case 'ArrowUp': v.muted = false; v.volume = Math.min(1, v.volume + 0.1); this._toast('Volume ' + Math.round(v.volume * 100) + '%'); break;
      case 'ArrowDown': v.volume = Math.max(0, v.volume - 0.1); this._toast('Volume ' + Math.round(v.volume * 100) + '%'); break;
      case 'm': case 'M': this._action('mute'); this._toast(v.muted ? 'Muted' : 'Sound on'); break;
      case 'f': case 'F': this.toggleFullscreen(); break;
      case 'p': case 'P': this.togglePip(); break;
      case '>': this._setRate(v.playbackRate + 0.25); break;
      case '<': this._setRate(v.playbackRate - 0.25); break;
      case 'Home': this.seek(0); break;
      case 'End': this.seek(v.duration || 0); break;
      case '?': this._help(this.els.help.hidden); break;
      case ',': case '.': this._jumpChapter(k === '.' ? 1 : -1); break;
      default:
        if (/^[0-9]$/.test(k) && isFinite(v.duration)) this.seek(v.duration * parseInt(k, 10) / 10);
        else handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); this._wake(); }
  };

  proto._jumpChapter = function (dir) {
    var c = this._chapters || [], t = this.els.video.currentTime || 0;
    if (!c.length) return;
    var target = null;
    if (dir > 0) { for (var i = 0; i < c.length; i++) if (c[i].time > t + 0.5) { target = c[i]; break; } }
    else { for (var j = c.length - 1; j >= 0; j--) if (c[j].time < t - 2) { target = c[j]; break; } if (!target) target = c[0]; }
    if (target) { this.seek(target.time); this._toast(target.title); }
  };

  customElements.define('drive-player', DrivePlayer);

  /* ------------------------------------------------------------------ *
   * Page helpers: open any Drive video in a lightbox with a data attribute
   *
   *   <button data-drive-src="DRIVE_LINK" data-title="Intro">Watch</button>
   *   <button data-drive-player-open="myPlayerId">Show tutorial</button>
   * ------------------------------------------------------------------ */

  var shared = null;

  function openModal(opts) {
    opts = opts || {};
    if (!shared) {
      shared = document.createElement('drive-player');
      shared.setAttribute('mode', 'modal');
      document.body.appendChild(shared);
    }
    ['chapters', 'start', 'poster', 'api-key'].forEach(function (k) {
      var key = k === 'api-key' ? 'apiKey' : k;
      if (opts[key] != null) shared.setAttribute(k, opts[key]); else shared.removeAttribute(k);
    });
    if (opts.title) shared.setAttribute('heading', opts.title); else shared.removeAttribute('heading');
    if (shared.getAttribute('src') !== opts.src) shared.setAttribute('src', opts.src || '');
    else if (opts.start != null) shared.seek(parseTime(opts.start));
    shared.open();
    return shared;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-drive-src],[data-drive-player-open]');
    if (!t) return;
    e.preventDefault();
    var id = t.getAttribute('data-drive-player-open');
    if (id) {
      var el = document.getElementById(id);
      if (el && el.open) el.open();
      return;
    }
    openModal({
      src: t.getAttribute('data-drive-src'),
      title: t.getAttribute('data-title') || t.getAttribute('title') || '',
      chapters: t.getAttribute('data-chapters'),
      start: t.getAttribute('data-start')
    });
  });

  window.DrivePlayer = {
    parseId: parseDriveId,
    open: openModal,
    urls: driveUrls,
    /** Create a player in JS: DrivePlayer.create({ src, mode: 'floating', title: 'Tour' }) */
    create: function (opts) {
      opts = opts || {};
      var el = document.createElement('drive-player');
      Object.keys(opts).forEach(function (k) {
        if (k === 'target' || opts[k] == null || opts[k] === false) return;
        var name = k === 'title' ? 'heading' : k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
        el.setAttribute(name, opts[k] === true ? '' : opts[k]);
      });
      var target = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
      (target || document.body).appendChild(el);
      return el;
    }
  };
})();
