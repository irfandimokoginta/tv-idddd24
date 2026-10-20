/*
 * TV Indonesia — modul aplikasi TizenBrew
 * Memutar playlist M3U (HLS) dengan hls.js, dikendalikan remote TV Samsung.
 *
 * Ubah CONFIG.playlists untuk menambah atau mengganti sumber playlist.
 * Kode ditulis gaya ES2015 sederhana (tanpa async/await) agar aman di Tizen lama.
 */
(function () {
  'use strict';

  var CONFIG = {
    // Bisa diisi lebih dari satu playlist; channel yang URL-nya sama akan digabung.
    // 'playlist/indonesia.m3u' = playlist kurasi yang ikut di dalam modul ini
    // (hanya server resmi stasiun TV / hosting stasiun lokal).
    playlists: [
      'playlist/indonesia.m3u'
      // , 'https://iptv-org.github.io/iptv/countries/id.m3u'
    ],
    loadTimeoutMs: 20000, // batas waktu menunggu stream mulai berputar
    osdMs: 3500,          // lama info channel tampil
    numberEntryMs: 1600   // jeda setelah menekan angka sebelum pindah channel
  };

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27, BACKSPACE: 8,
    CH_UP: 427, CH_DOWN: 428, PAGE_UP: 33, PAGE_DOWN: 34,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, INFO: 457,
    // Tombol keyboard untuk uji coba di laptop
    KB_R: 82, KB_G: 71, KB_Y: 89, KB_B: 66, KB_I: 73
  };

  var CATEGORY_ID = {
    'General': 'Umum', 'News': 'Berita', 'Entertainment': 'Hiburan',
    'Religious': 'Religi', 'Sports': 'Olahraga', 'Kids': 'Anak',
    'Music': 'Musik', 'Movies': 'Film', 'Education': 'Edukasi',
    'Business': 'Bisnis', 'Documentary': 'Dokumenter', 'Lifestyle': 'Gaya Hidup',
    'Culture': 'Budaya', 'Legislative': 'Legislatif', 'Shop': 'Belanja',
    'Travel': 'Wisata', 'Cooking': 'Kuliner', 'Series': 'Serial',
    'Comedy': 'Komedi', 'Family': 'Keluarga', 'Outdoor': 'Alam',
    'Science': 'Sains', 'Animation': 'Animasi', 'Auto': 'Otomotif',
    'Classic': 'Klasik', 'Weather': 'Cuaca', 'Public': 'Publik',
    'Undefined': 'Lainnya'
  };

  // ---------- Elemen ----------
  var $ = function (id) { return document.getElementById(id); };
  var video = $('video');
  var panel = $('panel');
  var listEl = $('list');
  var listInner = $('listInner');
  var subtitleEl = $('subtitle');
  var filterEl = $('filter');
  var osd = $('osd');
  var messageEl = $('message');
  var messageText = $('messageText');
  var numEntryEl = $('numEntry');

  // ---------- Penyimpanan (dibungkus try/catch) ----------
  var store = {
    get: function (k, fallback) {
      try {
        var v = window.localStorage.getItem(k);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ }
    }
  };

  // ---------- State ----------
  var all = [];            // semua channel
  var view = [];           // channel setelah filter
  var focus = 0;           // indeks fokus di view
  var playing = null;      // channel yang sedang diputar
  var playingOk = false;   // stream sudah benar-benar berputar
  var panelVisible = true;
  var favs = store.get('tvid.favs', {});
  var bad = {};            // channel gagal di sesi ini
  var favOnly = store.get('tvid.favOnly', false);
  var categories = [];     // [{key, label, count}]
  var catIndex = 0;        // 0 = semua kategori

  // ---------- Utilitas ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function catLabel(key) { return CATEGORY_ID[key] || key; }

  var osdTimer = null;
  function showOSD(ch, status) {
    if (!ch) return;
    $('osdNum').textContent = ch.num;
    $('osdName').textContent = ch.name;
    $('osdStatus').textContent = status || '';
    osd.className = 'show';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.className = ''; }, CONFIG.osdMs);
  }

  function showMessage(text, loading) {
    messageText.textContent = text;
    messageEl.className = 'show' + (loading ? ' loading' : '') + (panelVisible ? ' withPanel' : '');
  }
  function hideMessage() { messageEl.className = ''; }

  function setPanel(visible) {
    panelVisible = visible;
    panel.className = visible ? '' : 'hidden';
    if (messageEl.className.indexOf('show') !== -1) {
      messageEl.className = messageEl.className.replace(' withPanel', '') + (visible ? ' withPanel' : '');
    }
    if (visible) render();
  }

  function nameKey(name) {
    return String(name).toLowerCase()
      .replace(/\(tidak 24 jam\)|\[[^\]]*\]|\(\d{3,4}[pi]\)/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // ---------- Parser M3U ----------
  function parseM3U(text) {
    var lines = text.split(/\r?\n/);
    var out = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        var attrs = {};
        var re = /([\w-]+)="([^"]*)"/g;
        var m;
        while ((m = re.exec(line)) !== null) attrs[m[1].toLowerCase()] = m[2];
        var stripped = line.replace(/([\w-]+)="[^"]*"/g, '');
        var name = stripped.substring(stripped.indexOf(',') + 1).trim();
        var groups = (attrs['group-title'] || 'Undefined').split(';')
          .map(function (g) { return g.trim(); })
          .filter(function (g) { return g; });
        cur = {
          name: name || attrs['tvg-name'] || 'Tanpa nama',
          logo: attrs['tvg-logo'] || '',
          groups: groups.length ? groups : ['Undefined'],
          url: ''
        };
      } else if (line.charAt(0) !== '#' && cur) {
        cur.url = line;
        out.push(cur);
        cur = null;
      }
    }
    return out;
  }

  // ---------- Memuat playlist ----------
  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function loadPlaylists() {
    subtitleEl.textContent = 'Memuat daftar channel…';
    showMessage('Memuat daftar channel…', true);

    var jobs = CONFIG.playlists.map(function (u) {
      return fetchText(u).then(function (t) { return t; }, function () { return null; });
    });

    return Promise.all(jobs).then(function (texts) {
      var fresh = texts.filter(function (t) { return t; });
      var fromCache = false;
      if (fresh.length) {
        store.set('tvid.cache', fresh);
      } else {
        fresh = store.get('tvid.cache', []);
        fromCache = fresh.length > 0;
      }

      // Entri dengan nama sama digabung: URL kedua dst. menjadi cadangan.
      var byName = {};
      var merged = [];
      fresh.forEach(function (t) {
        parseM3U(t).forEach(function (ch) {
          var key = nameKey(ch.name);
          var existing = byName[key];
          if (existing) {
            if (existing.urls.indexOf(ch.url) === -1) existing.urls.push(ch.url);
            if (!existing.logo && ch.logo) existing.logo = ch.logo;
            return;
          }
          ch.urls = [ch.url];
          byName[key] = ch;
          merged.push(ch);
        });
      });
      merged.forEach(function (ch, i) { ch.num = i + 1; });
      all = merged;

      buildCategories();
      applyFilter(true);

      if (!all.length) {
        subtitleEl.textContent = 'Tidak ada channel';
        showMessage('Daftar channel gagal dimuat. Periksa koneksi internet TV, lalu tekan tombol BIRU untuk mencoba lagi.', false);
        return;
      }
      hideMessage();
      if (fromCache) {
        showMessage('Tidak bisa mengambil playlist terbaru, memakai daftar tersimpan.', false);
        setTimeout(hideMessage, 3000);
      }
      resumeLast();
    });
  }

  function buildCategories() {
    var counts = {};
    all.forEach(function (ch) {
      ch.groups.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; });
    });
    // Urutan kategori mengikuti urutan kemunculan di playlist; 'Lainnya' di akhir.
    categories = Object.keys(counts).sort(function (a, b) {
      return (a === 'Undefined' ? 1 : 0) - (b === 'Undefined' ? 1 : 0);
    }).map(function (k) { return { key: k, label: catLabel(k), count: counts[k] }; });
    if (catIndex > categories.length) catIndex = 0;
  }

  function applyFilter(keepFocus) {
    var focusedUrl = focus >= 0 && view[focus] ? view[focus].url : (playing ? playing.url : null);
    var prevFocus = focus;
    var cat = catIndex > 0 ? categories[catIndex - 1] : null;
    view = all.filter(function (ch) {
      if (favOnly && !favs[ch.url]) return false;
      if (cat && ch.groups.indexOf(cat.key) === -1) return false;
      return true;
    });
    focus = prevFocus < 0 ? prevFocus : 0;
    if (keepFocus && focusedUrl && prevFocus >= 0) {
      for (var i = 0; i < view.length; i++) {
        if (view[i].url === focusedUrl) { focus = i; break; }
      }
    }
    var label = (favOnly ? 'Favorit' : 'Semua channel') + (cat ? ' · ' + cat.label : '');
    filterEl.textContent = label;
    subtitleEl.textContent = view.length + ' channel' +
      (favOnly && !view.length ? ' — tekan ► pada channel untuk menambah favorit' : '');
    render();
  }

  // ---------- Baris menu (agar bisa dipakai tanpa tombol warna) ----------
  // Indeks fokus negatif = baris menu di atas daftar channel.
  var ACTIONS = [
    { icon: '🗂', label: function () {
        return 'Kategori: ' + (catIndex > 0 ? categories[catIndex - 1].label : 'Semua');
      }, run: function () { cycleCategory(); } },
    { icon: '★', label: function () {
        return 'Tampilkan: ' + (favOnly ? 'Favorit saja' : 'Semua channel');
      }, run: function () { toggleFavOnly(); } },
    { icon: '↻', label: function () { return 'Muat ulang daftar channel'; },
      run: function () { bad = {}; loadPlaylists(); } }
  ];
  var A = ACTIONS.length;

  // ---------- Tampilan daftar (hanya baris yang terlihat) ----------
  function rowHeightPx() { return window.innerHeight * 0.078; }

  function render() {
    if (!panelVisible) return;
    var total = A + view.length;
    var cur = focus + A;
    var rows = Math.max(5, Math.floor(listEl.clientHeight / rowHeightPx()));
    var start = Math.min(Math.max(0, cur - Math.floor(rows / 2)), Math.max(0, total - rows));
    var end = Math.min(total, start + rows);
    var html = '';
    for (var j = start; j < end; j++) {
      var i = j - A;
      if (i < 0) {
        var act = ACTIONS[j];
        html += '<div class="ch action' + (i === focus ? ' focused' : '') + '">' +
          '<div class="num">' + act.icon + '</div>' +
          '<div class="meta"><div class="name">' + esc(act.label()) + '</div>' +
          '<div class="group">tekan OK</div></div></div>';
        continue;
      }
      var ch = view[i];
      var cls = 'ch' + (i === focus ? ' focused' : '') + (playing && playing.url === ch.url ? ' playing' : '');
      html += '<div class="' + cls + '">' +
        '<div class="num">' + ch.num + '</div>' +
        (ch.logo
          ? '<img class="logo" src="' + esc(ch.logo) + '" onerror="this.style.visibility=\'hidden\'">'
          : '<div class="logo"></div>') +
        '<div class="meta"><div class="name">' + esc(ch.name) + '</div>' +
        '<div class="group">' + esc(ch.groups.map(catLabel).join(' · ')) + '</div></div>' +
        '<div class="flags">' +
          (favs[ch.url] ? '<span class="fav">★</span>' : '') +
          (bad[ch.url] ? '<span class="bad">✕</span>' : '') +
        '</div></div>';
    }
    listInner.innerHTML = html;
  }

  function moveFocus(delta) {
    focus = Math.min(view.length - 1, Math.max(-A, focus + delta));
    render();
  }

  // ---------- Pemutar ----------
  var hls = null;
  var attempt = 0;
  var loadTimer = null;
  var candidates = [];
  var candIdx = 0;
  var mediaRecovered = false;
  var hideOnPlay = false;

  function stopCurrent() {
    attempt++;
    clearTimeout(loadTimer);
    if (hls) { try { hls.destroy(); } catch (e) { /* abaikan */ } hls = null; }
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (e) { /* abaikan */ }
  }

  function buildCandidates(ch) {
    var list = [];
    (ch.urls || [ch.url]).forEach(function (url) {
      // Halaman https tidak boleh memuat stream http; coba versi https lebih dulu.
      if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
        list.push('https://' + url.slice(7));
      }
      list.push(url);
    });
    return list;
  }

  function looksLikeHls(url) {
    if (/\.m3u8(\?|#|$)/i.test(url)) return true;
    return !/\.(mp4|webm|mkv|mp3|aac|ts)(\?|#|$)/i.test(url);
  }

  function play(ch, opts) {
    if (!ch) return;
    opts = opts || {};
    stopCurrent();
    playing = ch;
    playingOk = false;
    hideOnPlay = !!opts.hidePanel;
    store.set('tvid.last', ch.url);
    candidates = buildCandidates(ch);
    candIdx = 0;
    showOSD(ch, 'Memuat…');
    showMessage('Memuat ' + ch.name + '…', true);
    render();
    tryCandidate();
  }

  function tryCandidate() {
    if (candIdx >= candidates.length) { fail(); return; }
    var my = ++attempt;
    var url = candidates[candIdx];
    if (candIdx > 0 && playing) {
      showOSD(playing, 'Mencoba sumber cadangan ' + (candIdx + 1) + ' dari ' + candidates.length + '…');
    }
    mediaRecovered = false;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (my === attempt && !playingOk) nextCandidate(my);
    }, CONFIG.loadTimeoutMs);

    var useHlsJs = looksLikeHls(url) && window.Hls && window.Hls.isSupported();

    if (useHlsJs) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3
      });
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (my !== attempt || !data || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          try { hls.recoverMediaError(); return; } catch (e) { /* lanjut ke kandidat berikut */ }
        }
        nextCandidate(my);
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        if (my !== attempt) return;
        safePlay();
      });
      hls.attachMedia(video);
      hls.loadSource(url);
    } else {
      video.src = url;
      safePlay();
    }
  }

  function safePlay() {
    try {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* autoplay ditolak: tunggu event lain */ });
    } catch (e) { /* abaikan */ }
  }

  function nextCandidate(my) {
    if (my !== attempt) return;
    if (hls) { try { hls.destroy(); } catch (e) { /* abaikan */ } hls = null; }
    candIdx++;
    tryCandidate();
  }

  function fail() {
    var ch = playing;
    stopCurrent();
    if (!ch) return;
    bad[ch.url] = true;
    playingOk = false;
    setPanel(true);
    showMessage('"' + ch.name + '" tidak bisa diputar. Stream mungkin sedang mati, dibatasi wilayah, atau butuh izin khusus. Coba channel lain.', false);
    showOSD(ch, 'Gagal diputar');
    render();
  }

  video.addEventListener('playing', function () {
    if (!playing) return;
    playingOk = true;
    clearTimeout(loadTimer);
    delete bad[playing.url];
    hideMessage();
    showOSD(playing, 'Live');
    if (hideOnPlay) { hideOnPlay = false; setPanel(false); }
    render();
  });

  video.addEventListener('waiting', function () {
    if (playing && playingOk) showOSD(playing, 'Buffering…');
  });

  video.addEventListener('error', function () {
    if (hls || !playing) return; // error hls.js ditangani lewat event Hls
    nextCandidate(attempt);
  });

  // ---------- Aksi ----------
  function zap(dir) {
    if (!view.length) return;
    var idx = -1;
    if (playing) {
      for (var i = 0; i < view.length; i++) {
        if (view[i].url === playing.url) { idx = i; break; }
      }
    }
    if (idx === -1) idx = focus - dir;
    var n = (idx + dir + view.length) % view.length;
    focus = n;
    play(view[n], { hidePanel: !panelVisible });
  }

  function toggleFav(ch) {
    if (!ch) return;
    if (favs[ch.url]) delete favs[ch.url]; else favs[ch.url] = true;
    store.set('tvid.favs', favs);
    showOSD(ch, favs[ch.url] ? '★ Ditambahkan ke favorit' : 'Dihapus dari favorit');
    if (favOnly) applyFilter(true); else render();
  }

  function toggleFavOnly() {
    favOnly = !favOnly;
    store.set('tvid.favOnly', favOnly);
    if (!panelVisible) setPanel(true);
    applyFilter(true);
  }

  function cycleCategory() {
    catIndex = (catIndex + 1) % (categories.length + 1);
    if (!panelVisible) setPanel(true);
    applyFilter(false);
  }

  function togglePlayPause() {
    if (!playing) return;
    if (video.paused) { safePlay(); showOSD(playing, 'Live'); }
    else { video.pause(); showOSD(playing, 'Dijeda'); }
  }

  function exitApp() {
    stopCurrent();
    try {
      if (window.history.length > 1) { window.history.back(); return; }
    } catch (e) { /* abaikan */ }
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) { /* abaikan */ }
  }

  function resumeLast() {
    var last = store.get('tvid.last', null);
    if (!last) return;
    for (var i = 0; i < view.length; i++) {
      if (view[i].url === last) {
        focus = i;
        render();
        play(view[i], { hidePanel: true });
        return;
      }
    }
  }

  // ---------- Input angka ----------
  var numBuffer = '';
  var numTimer = null;
  function pushDigit(d) {
    if (numBuffer.length >= 4) numBuffer = '';
    numBuffer += d;
    numEntryEl.textContent = numBuffer;
    numEntryEl.className = 'show';
    clearTimeout(numTimer);
    numTimer = setTimeout(commitNumber, CONFIG.numberEntryMs);
  }
  function commitNumber() {
    var n = parseInt(numBuffer, 10);
    numBuffer = '';
    numEntryEl.className = '';
    if (!n) return;
    var target = null;
    for (var i = 0; i < all.length; i++) { if (all[i].num === n) { target = all[i]; break; } }
    if (!target) { showMessage('Channel nomor ' + n + ' tidak ada.', false); setTimeout(hideMessage, 2000); return; }
    for (var j = 0; j < view.length; j++) { if (view[j].url === target.url) { focus = j; break; } }
    play(target, { hidePanel: !panelVisible });
  }

  // ---------- Remote ----------
  function registerKeys() {
    var names = ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow',
      'ColorF3Blue', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'Info',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    try {
      var tvi = window.tizen && window.tizen.tvinputdevice;
      if (!tvi) return;
      if (tvi.registerKeyBatch) { tvi.registerKeyBatch(names); return; }
      names.forEach(function (n) { try { tvi.registerKey(n); } catch (e) { /* abaikan */ } });
    } catch (e) { /* bukan di TV */ }
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;

    // Angka (remote, baris angka keyboard, numpad)
    if (k >= 48 && k <= 57) { pushDigit(String(k - 48)); e.preventDefault(); return; }
    if (k >= 96 && k <= 105) { pushDigit(String(k - 96)); e.preventDefault(); return; }

    var handled = true;
    switch (k) {
      case KEY.CH_UP: zap(-1); break;
      case KEY.CH_DOWN: zap(1); break;
      case KEY.RED: case KEY.KB_R:
        toggleFav(panelVisible && focus >= 0 ? view[focus] : playing); break;
      case KEY.GREEN: case KEY.KB_G: toggleFavOnly(); break;
      case KEY.YELLOW: case KEY.KB_Y: cycleCategory(); break;
      case KEY.BLUE: case KEY.KB_B: bad = {}; loadPlaylists(); break;
      case KEY.PLAYPAUSE: case KEY.PLAY: case KEY.PAUSE: togglePlayPause(); break;
      case KEY.INFO: case KEY.KB_I: showOSD(playing, playingOk ? 'Live' : ''); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); return; }

    if (panelVisible) {
      switch (k) {
        case KEY.UP: moveFocus(-1); break;
        case KEY.DOWN: moveFocus(1); break;
        case KEY.PAGE_UP: moveFocus(-8); break;
        case KEY.PAGE_DOWN: moveFocus(8); break;
        case KEY.ENTER:
          if (focus < 0) { ACTIONS[focus + A].run(); break; }
          var ch = view[focus];
          if (!ch) break;
          if (playing && playing.url === ch.url && playingOk) setPanel(false);
          else play(ch, { hidePanel: true });
          break;
        case KEY.RIGHT:
          if (focus >= 0) toggleFav(view[focus]);
          break;
        case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE:
          if (playing && playingOk) setPanel(false); else exitApp();
          break;
        default: return;
      }
    } else {
      switch (k) {
        case KEY.UP: zap(-1); break;
        case KEY.DOWN: zap(1); break;
        case KEY.ENTER: case KEY.LEFT: case KEY.RIGHT:
        case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE:
          setPanel(true); break;
        default: return;
      }
    }
    e.preventDefault();
  });

  window.addEventListener('resize', render);

  // ---------- Mulai ----------
  registerKeys();
  if (!(window.Hls && window.Hls.isSupported())) {
    console.warn('hls.js tidak didukung di perangkat ini; memakai pemutar bawaan.');
  }
  loadPlaylists();
})();
