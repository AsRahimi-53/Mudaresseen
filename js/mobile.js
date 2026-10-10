/* Madrasa PD - mobile app shell (phase 1).
   Adds a bottom tab bar and a "More" sheet on phones. It reuses the existing
   [data-view] navigation, so it does not touch the application bundle. */
(function () {
  'use strict';
  var TABS = ['dashboard', 'members', 'madrasas', 'observations'];
  var ICONS = {
    'dashboard': '\uD83C\uDFE0', 'team-dashboard': '\uD83D\uDC65', 'members': '\uD83D\uDC64',
    'madrasas': '\uD83C\uDFEB', 'teachers': '\uD83C\uDF93', 'staff': '\uD83D\uDCBC',
    'statistics': '\uD83D\uDCCA', 'tashkil': '\uD83D\uDDC2\uFE0F', 'observations': '\uD83D\uDD0D',
    'annual-plans': '\uD83D\uDCC5', 'monthly-plans': '\uD83D\uDDD3\uFE0F', 'duties': '\u2705',
    'activities': '\u2B50', 'professional-development': '\uD83D\uDCDA', 'monitoring': '\uD83C\uDFAF',
    'reports': '\uD83D\uDCC4', 'super-admin': '\u2B50', 'classes': '\uD83C\uDF92', 'exam-results': '\uD83D\uDCDD', 'regulations': '\u2696\uFE0F', 'backup': '\uD83D\uDCBE', 'settings': '\u2699\uFE0F'
  };
  var bar = null, sheet = null, backdrop = null, raf = 0;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function moreLabel() { return document.documentElement.lang === 'fa' ? '\u0628\u06CC\u0634\u062A\u0631' : '\u0646\u0648\u0631'; }
  function navBtn(view) { return q('#main-nav .nav-link[data-view="' + view + '"]'); }
  function labelOf(btn) { var s = btn.querySelectorAll('span'); return (s.length ? s[s.length - 1] : btn).textContent.trim(); }
  function iconOf(view, btn) { return ICONS[view] || (btn && q('.nav-icon', btn) ? q('.nav-icon', btn).textContent : '\u2022'); }
  function activeView() { var a = q('#main-nav .nav-link.active'); return a ? a.getAttribute('data-view') : ''; }

  function refresh() {
    raf = 0;
    if (!bar) return;
    if (sheet && !document.body.classList.contains('m-sheet-open')) sheet.textContent = '';
    var av = activeView();
    Array.prototype.forEach.call(bar.querySelectorAll('.m-tab[data-view]'), function (b) {
      var view = b.getAttribute('data-view'), n = navBtn(view);
      q('.m-tab-icon', b).textContent = iconOf(view, n);
      if (n) q('.m-tab-label', b).textContent = labelOf(n);
      b.classList.toggle('active', view === av);
    });
    var more = q('#m-more');
    q('.m-tab-label', more).textContent = moreLabel();
    more.classList.toggle('active', !!av && TABS.indexOf(av) === -1);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(refresh); }

  function fillSheet() {
    sheet.textContent = '';
    sheet.appendChild(el('div', 'm-sheet-handle'));
    var head = el('div', 'm-sheet-head');
    head.appendChild(el('div', 'm-sheet-title', moreLabel()));
    var st = q('#online-status');
    head.appendChild(el('div', 'm-sheet-status', st ? st.textContent.trim() : ''));
    sheet.appendChild(head);
    var nav = q('#main-nav'), av = activeView(), grid = null;
    if (!nav) return;
    var flat = [];
    Array.prototype.forEach.call(nav.children, function (n) {
      if (n.classList.contains('hidden')) return;
      if (n.classList.contains('nav-group')) { Array.prototype.forEach.call(n.children, function (c) { flat.push(c); }); } else { flat.push(n); }
    });
    flat.forEach(function (n) {
      if (n.classList.contains('nav-section-label')) {
        sheet.appendChild(el('div', 'm-sheet-section', n.textContent.trim()));
        grid = el('div', 'm-sheet-grid');
        sheet.appendChild(grid);
      } else if (n.classList.contains('nav-link')) {
        if (!grid) { grid = el('div', 'm-sheet-grid'); sheet.appendChild(grid); }
        var view = n.getAttribute('data-view');
        var b = el('button', 'm-sheet-item' + (view === av ? ' active' : ''));
        b.type = 'button';
        b.setAttribute('data-view', view);
        b.appendChild(el('span', 'm-ico', iconOf(view, n)));
        b.appendChild(el('span', 'm-lbl', labelOf(n)));
        grid.appendChild(b);
      }
    });
  }
  function openSheet() { fillSheet(); document.body.classList.add('m-sheet-open'); }
  function closeSheet() {
    document.body.classList.remove('m-sheet-open');
    // Do not keep menu entries (e.g. role-specific ones) in the page while the sheet is closed.
    setTimeout(function () { if (sheet && !document.body.classList.contains('m-sheet-open')) sheet.textContent = ''; }, 320);
  }

  function build() {
    var app = document.getElementById('app');
    if (!app || bar) return;
    bar = el('nav', 'm-tabbar');
    bar.setAttribute('aria-label', 'Main');
    TABS.forEach(function (view) {
      var b = el('button', 'm-tab');
      b.type = 'button';
      b.setAttribute('data-view', view);
      b.appendChild(el('span', 'm-tab-icon', '\u2022'));
      b.appendChild(el('span', 'm-tab-label', ''));
      bar.appendChild(b);
    });
    var more = el('button', 'm-tab');
    more.type = 'button';
    more.id = 'm-more';
    more.appendChild(el('span', 'm-tab-icon', '\u2630'));
    more.appendChild(el('span', 'm-tab-label', ''));
    bar.appendChild(more);
    app.parentNode.insertBefore(bar, app.nextSibling);

    backdrop = el('div', 'm-sheet-backdrop');
    sheet = el('div', 'm-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    bar.addEventListener('click', function (e) {
      if (e.target.closest('#m-more')) {
        if (document.body.classList.contains('m-sheet-open')) closeSheet(); else openSheet();
      } else if (e.target.closest('.m-tab[data-view]')) {
        closeSheet();
        window.scrollTo(0, 0);
      }
    });
    backdrop.addEventListener('click', closeSheet);
    sheet.addEventListener('click', function (e) {
      if (e.target.closest('[data-view]')) { closeSheet(); window.scrollTo(0, 0); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    // Hide the tab bar while the on-screen keyboard is open.
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(checkbox|radio|button|submit|file|range)$/.test(t.type || '')) {
        document.body.classList.add('m-kb');
      }
    });
    document.addEventListener('focusout', function () {
      setTimeout(function () {
        var a = document.activeElement;
        if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) document.body.classList.remove('m-kb');
      }, 60);
    });

    var nav = q('#main-nav');
    if (nav && window.MutationObserver) {
      new MutationObserver(schedule).observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    }
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
    var mq = window.matchMedia('(max-width: 820px)');
    var onChange = function () { if (!mq.matches) closeSheet(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    refresh();
  }

  /* ---- phase 2: data tables become cards on phones (CSS does the layout) ---- */
  var tRaf = 0;
  function decorateTables() {
    tRaf = 0;
    Array.prototype.forEach.call(document.querySelectorAll('table.data-table'), function (table) {
      var ths = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
      if (!ths.length) return;
      if (ths.length > 8) { table.classList.add('m-wide'); return; }
      table.classList.add('m-cards');
      Array.prototype.forEach.call(table.querySelectorAll('tbody tr:not([data-m])'), function (tr) {
        tr.setAttribute('data-m', '1');
        Array.prototype.forEach.call(tr.children, function (td, i) {
          if (td.tagName !== 'TD' || td.hasAttribute('colspan')) return;
          if (td.querySelector('.table-actions, .table-action')) { td.classList.add('m-act'); return; }
          if (ths[i]) td.setAttribute('data-label', ths[i]);
        });
      });
    });
  }
  function scheduleTables() { if (!tRaf) tRaf = requestAnimationFrame(decorateTables); }
  function initTables() {
    decorateTables();
    if (window.MutationObserver) new MutationObserver(scheduleTables).observe(document.body, { childList: true, subtree: true });
  }

  function init() { build(); initTables(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
