/* Inline SVG icons (no icon font, no network). Stroke icons on a 24 grid. */
(function () {
  'use strict';
  var MF = window.MF;
  var P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M9 6l6 6-6 6"/>',              /* RTL: "back" points to the right */
    forward: '<path d="M15 6l-6 6 6 6"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    warn: '<path d="M12 4.2 2.8 19.5h18.4z"/><path d="M12 10v4.4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
    upload: '<path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14"/>',
    sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 15h16M10 4v16"/>',
    archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12.5h4"/>',
    restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.7 7.7 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.7 7.7 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.7 7.7 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 2.6-1.5l2.4 1 2-3.5z"/>',
    counter: '<path d="M5 7h14M5 12h14M5 17h9"/><path d="M17 15v4M15 17h4"/>',
    undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    school: '<path d="M3 9.5 12 5l9 4.5-9 4.5z"/><path d="M7 11.5V16c1.5 1.5 3.2 2 5 2s3.5-.5 5-2v-4.5"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="5" cy="7" r=".8" fill="currentColor"/><circle cx="5" cy="12" r=".8" fill="currentColor"/><circle cx="5" cy="17" r=".8" fill="currentColor"/>',
    keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17.5 10.5h.01M7.5 14h9"/>',
    shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z"/>',
    drag: '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 18.5z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
    cloudOff: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 18.5z"/><path d="M4 4l16 16"/>',
    sync: '<path d="M19 12a7 7 0 0 1-12.2 4.7"/><path d="M5 12a7 7 0 0 1 12.2-4.7"/><path d="M17.5 3.5v4h-4M6.5 20.5v-4h4"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    logout: '<path d="M14 4.5h4.5v15H14"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 13.6a6 6 0 0 1 4 5.9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    split: '<path d="M6 4v5a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6"/><path d="M18 4v5a6 6 0 0 1-3 5.2"/><path d="M3.5 6.5 6 4l2.5 2.5M15.5 6.5 18 4l2.5 2.5"/>'
  };
  function icon(name, cls) {
    var p = P[name] || '';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + '</svg>';
  }
  /* station status ring: not started (open ring), in progress (half), completed (filled + check) */
  function statusRing(state, cls) {
    var c = 'ring ring-' + (state || 'not_started') + (cls ? ' ' + cls : '');
    var body;
    if (state === 'completed') {
      body = '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="currentColor"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8" stroke="var(--ring-check, #fff)" stroke-width="2" fill="none"/>';
    } else if (state === 'in_progress') {
      body = '<circle cx="12" cy="12" r="9" fill="none"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>';
    } else {
      body = '<circle cx="12" cy="12" r="9" fill="none" stroke-dasharray="2.4 2.6"/>';
    }
    return '<svg class="' + c + '" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  MF.icon = icon;
  MF.statusRing = statusRing;
})();
