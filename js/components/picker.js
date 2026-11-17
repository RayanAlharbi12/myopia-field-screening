/* =====================================================================
   MeasurePicker — one measurement control with three ways of input:
     1. swipe the vertical wheel (content follows the finger, momentum, snap)
     2. type a value (keyboard; numeric keyboard on mobile; visible snapping)
     3. tap the current value -> searchable value list
   All three change the same stored value. Starts and resets to "Not tested".

   Touch safety: a wheel is inert to touch until it is tapped once ("armed"),
   so swiping the page across a wheel scrolls the page and never changes a value.
   While armed, the wheel owns vertical drags (no page movement).
   Mouse and pen drag immediately.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, F = MF.fmt, esc = D.esc;

  var ALL = [];
  var TAU = 325;                     /* kinetic decay constant (ms) */

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function label(kind, v) { return kind === 'axis' ? v + '°' : kind === 'va' ? v : F.power(v); }

  function Picker(host, o) {
    this.host = host; this.o = o; this.kind = o.kind;
    this.scale = MF.SCALES[o.kind];
    this.values = this.scale.values;
    this.n = this.values.length;
    this.restIndex = Math.max(0, this.values.indexOf(this.scale.rest));
    this.pos = this.restIndex;
    this.anim = null; this.drag = null; this.armed = false; this.wheelAcc = 0;
    this.build();
    this.bind();
    this.sync(true);
    ALL.push(this);
  }

  Picker.prototype.build = function () {
    var o = this.o, rows = '';
    for (var i = 0; i < this.n; i++) {
      var v = this.values[i];
      rows += '<div class="mp-row' + (o.flag && o.flag(v) ? ' is-flag' : '') + '" data-i="' + i + '"><bdi dir="ltr">' + esc(label(this.kind, v)) + '</bdi></div>';
    }
    this.host.classList.add('mp');
    this.host.setAttribute('data-kind', this.kind);
    this.host.innerHTML =
      '<div class="mp-head"><span class="mp-label">' + esc(o.label) + '</span>' + (o.sub ? '<span class="mp-sub">' + esc(o.sub) + '</span>' : '') + '</div>' +
      '<div class="mp-wheel" tabindex="0" role="spinbutton" aria-roledescription="picker" aria-label="' + esc(o.aria || o.label) + '">' +
        '<div class="mp-track">' + rows + '</div>' +
        '<div class="mp-band" aria-hidden="true"></div>' +
        '<div class="mp-nt" aria-hidden="true"><span>Not tested</span></div>' +
        '<div class="mp-arm" aria-hidden="true">اسحب للتغيير · اضغط القيمة للقائمة</div>' +
      '</div>' +
      '<p class="mp-note" role="status" hidden></p>';
    this.wheel = this.host.querySelector('.mp-wheel');
    this.track = this.host.querySelector('.mp-track');
    this.rows = this.track.children;
    this.note = this.host.querySelector('.mp-note');
    this.lo = -1; this.hi = -1;
    this.measure();
  };

  Picker.prototype.measure = function () {
    var cs = getComputedStyle(this.wheel);
    this.rh = parseFloat(cs.getPropertyValue('--rh')) || 44;
    this.h = this.wheel.clientHeight || this.rh * 5;
  };

  Picker.prototype.value = function () { var v = this.o.get(); return v === undefined ? null : v; };
  Picker.prototype.isNT = function () { return this.value() == null; };
  Picker.prototype.indexOf = function (v) { return this.values.indexOf(v); };

  /* ---- rendering ---- */
  Picker.prototype.render = function () {
    var off = (this.h - this.rh) / 2 - this.pos * this.rh;
    this.track.style.transform = 'translate3d(0,' + off.toFixed(2) + 'px,0)';
    var c = Math.round(clamp(this.pos, 0, this.n - 1)), lo = Math.max(0, c - 3), hi = Math.min(this.n - 1, c + 3), i;
    for (i = this.lo; i >= 0 && i <= this.hi; i++) if (i < lo || i > hi) this.rows[i].removeAttribute('data-d');
    for (i = lo; i <= hi; i++) this.rows[i].setAttribute('data-d', Math.min(3, Math.abs(i - c)));
    this.lo = lo; this.hi = hi;
    var live = this.drag || this.anim;
    var shown = live ? this.values[c] : this.value();
    var nt = !live && shown == null;
    this.wheel.classList.toggle('is-nt', nt);
    this.wheel.classList.toggle('is-flag', !nt && !!(this.o.flag && this.o.flag(shown)));
    this.wheel.setAttribute('aria-valuetext', nt ? 'Not tested' : label(this.kind, shown));
  };

  /* reflect the stored value (never while the examiner's finger is on the wheel) */
  Picker.prototype.sync = function (instant) {
    if (this.drag) return;
    var v = this.value(), i = v == null ? this.restIndex : this.indexOf(v);
    if (i < 0) i = this.restIndex;
    if (instant || D.prefersReducedMotion()) { this.stop(); this.pos = i; this.render(); }
    else if (Math.abs(i - this.pos) > 0.001 && !this.anim) this.animateTo(i, false);
    else this.render();
  };

  Picker.prototype.stop = function () { if (this.anim) { cancelAnimationFrame(this.anim.raf); this.anim = null; } };

  /* glide to an integer index and commit when it lands.
     momentum: the glide starts at the finger's release speed and decelerates smoothly. */
  Picker.prototype.animateTo = function (target, commit, velocity) {
    var self = this;
    this.stop();
    target = clamp(Math.round(target), 0, this.n - 1);
    var from = this.pos, dist = target - from, start = now(), T;
    if (Math.abs(dist) < 0.001) { this.pos = target; this.render(); if (commit) this.commitIndex(target); return; }
    if (velocity) T = clamp(3 * Math.abs(dist) / Math.abs(velocity), 260, 1100);   /* cubic ease-out: v0 = 3·dist/T */
    else T = clamp(150 + 70 * Math.abs(dist), 150, 380);
    var a = this.anim = { raf: 0, momentum: !!velocity };
    function step() {
      var t = Math.min(1, (now() - start) / T);
      var e = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        self.pos = target; self.anim = null; self.render();
        if (commit) self.commitIndex(target);
        return;
      }
      self.pos = from + dist * e; self.render();
      a.raf = requestAnimationFrame(step);
    }
    a.raf = requestAnimationFrame(step);
  };

  Picker.prototype.commitIndex = function (i, meta) {
    var v = this.values[clamp(i, 0, this.n - 1)];
    if (v !== this.value()) this.o.set(v, meta || {});
    this.render();
  };
  Picker.prototype.setValue = function (v, meta) {
    if (v == null) { this.o.set(null, meta || {}); this.stop(); this.pos = this.restIndex; this.render(); return; }
    var i = this.indexOf(v);
    if (i < 0) return;
    this.o.set(v, meta || {});
    this.animateTo(i, false);
  };

  /* ---- arming (touch only) ---- */
  Picker.prototype.arm = function () {
    ALL.forEach(function (p) { if (p !== this) p.disarm(); }, this);
    this.armed = true;
    this.wheel.classList.add('is-armed');
    try { this.wheel.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };
  Picker.prototype.disarm = function () {
    if (!this.armed) return;
    this.armed = false;
    this.wheel.classList.remove('is-armed');
  };

  Picker.prototype.rowAt = function (clientY) {
    var r = this.wheel.getBoundingClientRect();
    var dy = clientY - (r.top + r.height / 2);
    return clamp(Math.round(this.pos + dy / this.rh), 0, this.n - 1);
  };

  Picker.prototype.bind = function () {
    var self = this, w = this.wheel;

    w.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      self.pendingOpen = false;
      var touch = e.pointerType === 'touch';
      var caught = !!(self.anim && self.anim.momentum);   /* a touch during a glide stops it where it is */
      self.stop();
      self.drag = null;
      self.down = { x: e.clientX, y: e.clientY, t: now(), touch: touch, active: !touch || self.armed, moved: false, pos: self.pos, caught: caught };
      if (self.down.active) {
        try { w.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        self.samples = [{ t: now(), p: self.pos }];
        if (!touch) { e.preventDefault(); try { w.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
      }
    });

    w.addEventListener('pointermove', function (e) {
      var d = self.down;
      if (!d) return;
      var dy = e.clientY - d.y;
      if (!d.moved && (Math.abs(dy) > 5 || Math.abs(e.clientX - d.x) > 8)) d.moved = true;
      if (!d.active || !d.moved) return;
      if (!self.drag) { self.drag = true; w.classList.add('is-drag'); }
      /* content follows the finger: finger up -> list moves up -> next lower value comes to the centre */
      var p = d.pos - dy / self.rh;
      if (p < 0) p = -Math.pow(-p, 0.7) * 0.6;                          /* rubber band at the ends */
      else if (p > self.n - 1) p = (self.n - 1) + Math.pow(p - (self.n - 1), 0.7) * 0.6;
      self.pos = p;
      var t = now();
      self.samples.push({ t: t, p: p });
      while (self.samples.length > 2 && t - self.samples[0].t > 90) self.samples.shift();
      self.render();
      e.preventDefault();
    });

    function release(e, cancelled) {
      var d = self.down;
      self.down = null;
      if (!d) return;
      try { w.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      w.classList.remove('is-drag');
      if (cancelled) { self.drag = null; if (d.active && d.moved) self.animateTo(self.pos, true); else self.render(); return; }
      if (!d.moved) {
        self.drag = null;
        if (d.caught) { self.animateTo(self.pos, true); return; }
        if (d.touch && !self.armed) { self.arm(); return; }   /* first tap only arms the wheel */
        var i = self.rowAt(e.clientY);
        /* tap the current value -> list. Opened on the click that follows, so that click
           cannot land on the new sheet (a "ghost" tap could otherwise pick a value). */
        if (i === Math.round(self.pos)) { self.pendingOpen = true; return; }
        self.animateTo(i, true);
        return;
      }
      if (!d.active) return;
      /* momentum */
      var s = self.samples, v = 0;
      if (s.length >= 2) {
        var a = s[0], b = s[s.length - 1], dt = b.t - a.t;
        if (dt > 0 && now() - b.t < 60) v = (b.p - a.p) / dt;             /* rows per ms */
      }
      self.drag = null;
      if (self.pos < 0 || self.pos > self.n - 1 || Math.abs(v) < 0.0012 || D.prefersReducedMotion()) {
        self.animateTo(self.pos, true);
      } else {
        var target = clamp(Math.round(self.pos + v * TAU), 0, self.n - 1);
        self.animateTo(target, true, v);
      }
    }
    w.addEventListener('pointerup', function (e) { release(e, false); });
    w.addEventListener('click', function () { if (self.pendingOpen) { self.pendingOpen = false; self.openList(); } });
    w.addEventListener('pointercancel', function (e) { release(e, true); });

    /* mouse wheel / trackpad: only while this wheel is focused, so the page scrolls otherwise */
    w.addEventListener('wheel', function (e) {
      if (document.activeElement !== w) return;
      e.preventDefault();
      var dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
      self.wheelAcc += dy;
      var steps = 0;
      while (self.wheelAcc >= 36) { steps++; self.wheelAcc -= 36; }
      while (self.wheelAcc <= -36) { steps--; self.wheelAcc += 36; }
      if (steps) self.stepBy(steps);
    }, { passive: false });

    w.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowUp') { e.preventDefault(); self.stepBy(-1); }
      else if (k === 'ArrowDown') { e.preventDefault(); self.stepBy(1); }
      else if (k === 'PageUp') { e.preventDefault(); self.stepBy(-5); }
      else if (k === 'PageDown') { e.preventDefault(); self.stepBy(5); }
      else if (k === 'Home') { e.preventDefault(); self.stop(); self.pos = 0; self.commitIndex(0); }
      else if (k === 'End') { e.preventDefault(); self.stop(); self.pos = self.n - 1; self.commitIndex(self.n - 1); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); self.openList(); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); self.resetNT(); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (self.kind === 'va' ? /[0-9a-zA-Z/]/.test(k) : /[0-9+\-.,٠-٩−]/.test(k))) {
        e.preventDefault(); self.openList(k);
      }
    });
    w.addEventListener('blur', function () { self.wheelAcc = 0; });
  };

  Picker.prototype.stepBy = function (d) {
    var base = this.isNT() ? this.restIndex - (d > 0 ? 1 : -1) : Math.round(this.pos);
    var i = clamp(base + d, 0, this.n - 1);
    this.stop();
    this.pos = i;
    this.commitIndex(i);
  };

  Picker.prototype.resetNT = function () {
    var prev = this.value();
    if (prev == null) return;
    var self = this;
    this.setValue(null, { reset: true });
    this.showNote('');
    MF.ui.toast((this.o.aria || this.o.label) + ': أُعيدت إلى Not tested', { action: { label: 'تراجع', fn: function () { self.setValue(prev, { undo: true }); } } });
  };

  Picker.prototype.showNote = function (text, tone) {
    var n = this.note;
    clearTimeout(this.noteT);
    if (!text) { n.hidden = true; return; }
    n.textContent = text;
    n.className = 'mp-note' + (tone ? ' ' + tone : '');
    n.hidden = false;
    this.noteT = setTimeout(function () { n.hidden = true; }, 5200);
  };

  /* ---- value list + typed entry ---- */
  Picker.prototype.openList = function (typed) {
    var self = this, kind = this.kind, cur = this.value();
    /* already open: keys typed quickly keep going into the same entry field */
    if (this.listInput) {
      if (typed) { this.listInput.value += typed; this.listInput.dispatchEvent(new Event('input')); }
      try { this.listInput.focus(); } catch (e) { /* ignore */ }
      return;
    }
    var signed = kind === 'sphere' || kind === 'cyl';
    var items = [{ v: null, t: 'Not tested' }].concat(this.values.map(function (v) { return { v: v, t: label(kind, v) }; }));
    var placeholder = kind === 'va' ? '6/12 · CF' : kind === 'axis' ? '175' : '-1.25';
    var body =
      '<div class="pl-entry">' +
        (signed ? '<div class="pl-sign" role="group" aria-label="الإشارة"><button type="button" class="opt compact center" data-sign="+">+</button><button type="button" class="opt compact center" data-sign="-">' + F.MINUS + '</button></div>' : '') +
        '<input class="input input-num pl-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done"' +
          ' inputmode="' + (kind === 'va' ? 'text' : 'decimal') + '" placeholder="' + esc(placeholder) + '" aria-label="اكتب القيمة">' +
        '<button type="button" class="btn btn-primary pl-apply">تطبيق</button>' +
      '</div>' +
      '<p class="pl-msg" role="status" hidden></p>' +
      '<div class="pl-list" role="listbox" aria-label="القيم">' +
        items.map(function (it, i) {
          var sel = it.v === cur;
          return '<button type="button" role="option" class="pl-item' + (it.v == null ? ' is-nt' : '') + (sel ? ' is-sel' : '') + (it.v != null && self.o.flag && self.o.flag(it.v) ? ' is-flag' : '') + '" aria-selected="' + sel + '" data-pi="' + i + '">' +
            (it.v == null ? '<span>إعادة إلى Not tested</span>' : '<bdi dir="ltr">' + esc(it.t) + '</bdi>') +
            (sel ? MF.icon('check', 'ic-sm') : '') + '</button>';
        }).join('') +
      '</div>';
    MF.ui.dialog({
      title: this.o.aria || this.o.label, body: body, sheet: true, focusFirst: false,
      onClose: function () { self.listInput = null; },
      onMount: function (el, api) {
        var input = el.querySelector('.pl-input'), msg = el.querySelector('.pl-msg'), list = el.querySelector('.pl-list');
        function showMsg(t, tone) { msg.hidden = !t; msg.className = 'pl-msg' + (tone ? ' ' + tone : ''); msg.innerHTML = t || ''; }
        function norm(s) { return D.normalizeDigits(s).toUpperCase().replace(/^\+/, ''); }
        function filter() {
          var q = norm(input.value);
          var bare = q.replace(/^-/, '');
          D.qsa('.pl-item', list).forEach(function (b, i) {
            var it = items[+b.getAttribute('data-pi')];
            if (!q || it.v == null) { b.hidden = !!q && it.v == null; return; }
            var t = norm(it.t).replace(/°$/, '');
            var tb = t.replace(/^-/, '');
            var ok = q.charAt(0) === '-' ? t.indexOf(q) === 0 : (input.value.trim().charAt(0) === '+' ? (t.charAt(0) !== '-' && tb.indexOf(bare) === 0) : tb.indexOf(bare) === 0);
            b.hidden = !ok;
          });
          showMsg('');
        }
        function apply(v, meta) {
          api.close();
          self.setValue(v, meta);
          if (meta && meta.snappedFrom) self.showNote('قُرِّبت ' + meta.snappedFrom + ' إلى ' + label(kind, v) + (kind === 'axis' ? ' (خطوات 5°)' : ' (خطوات 0.25 D)'), 'snap');
          else self.showNote('');
          try { self.wheel.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        function applyTyped() {
          var raw = input.value.trim();
          if (!raw) { showMsg('اكتب قيمة أو اختر من القائمة.', 'warn'); return; }
          var r = F.parse(kind, raw);
          if (r.nt) { apply(null, { typed: true }); return; }
          if (r.error) {
            var sug = (r.suggestions || []).map(function (s) { return '<button type="button" class="opt compact" data-sug="' + esc(s) + '"><bdi dir="ltr">' + esc(s) + '</bdi></button>'; }).join('');
            showMsg('<span>' + esc(r.error === 'empty' ? 'اكتب قيمة.' : r.error) + (sug ? ' — القيم الأقرب:' : '') + '</span>' + (sug ? '<span class="pl-sug">' + sug + '</span>' : ''), 'warn');
            return;
          }
          apply(r.value, { typed: true, snappedFrom: r.snapped ? r.from : null });
        }
        input.addEventListener('input', filter);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyTyped(); } });
        el.querySelector('.pl-apply').addEventListener('click', applyTyped);
        D.on(el, 'click', '[data-sign]', function (e, b) {
          var s = input.value.trim().replace(/^[+\-−]/, '');
          input.value = (b.getAttribute('data-sign') === '-' ? '-' : '+') + s;
          filter();
          input.focus();
        });
        D.on(el, 'click', '[data-sug]', function (e, b) { apply(b.getAttribute('data-sug'), { typed: true }); });
        D.on(el, 'click', '.pl-item', function (e, b) {
          var it = items[+b.getAttribute('data-pi')];
          if (it.v == null) { var prev = self.value(); api.close(); if (prev != null) self.resetNT(); return; }
          apply(it.v, { list: true });
        });
        /* scroll the current (or resting) value into view */
        var target = list.querySelector('.is-sel') || list.querySelectorAll('.pl-item')[self.restIndex + 1];
        if (target) requestAnimationFrame(function () { list.scrollTop = Math.max(0, target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2); });
        var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        self.listInput = input;
        if (typed) {
          input.value = (typed === '-' || typed === '\u2212') ? '-' : typed; filter();
          try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }   /* at once, so the next keys land here */
        } else if (!coarse) setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 40);
      }
    });
  };

  Picker.prototype.destroy = function () { this.stop(); var i = ALL.indexOf(this); if (i >= 0) ALL.splice(i, 1); };

  /* a tap anywhere outside the armed wheel disarms it */
  document.addEventListener('pointerdown', function (e) {
    ALL.forEach(function (p) { if (p.armed && !p.wheel.contains(e.target)) p.disarm(); });
  }, true);
  window.addEventListener('resize', function () {
    ALL = ALL.filter(function (p) { return document.body.contains(p.host); });
    ALL.forEach(function (p) { p.measure(); p.render(); });
  });

  MF.Picker = Picker;
  MF.Picker.all = function () { return ALL; };
  MF.Picker.prune = function () { ALL = ALL.filter(function (p) { return document.body.contains(p.host); }); };
})();
