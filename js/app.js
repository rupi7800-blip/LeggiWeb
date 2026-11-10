/* =========================================================
   LeggiWeb — legge ad alta voce pagine web in italiano e spagnolo
   Estrazione testo: r.jina.ai (principale) → proxy CORS + estrazione
   locale (riserva). Voce: Web Speech API del dispositivo.
   ========================================================= */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const synth = window.speechSynthesis;

/* ---------------- stato e salvataggi ---------------- */
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : Object.assign(Array.isArray(d) ? [] : {}, d, v); } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

const DEF = { rate: 1, pitch: 1, voiceIt: '', voiceEs: '', font: 19, theme: 'auto', autoLang: true, follow: true, bg: true, sleep: 0 };
const settings = load('lw.settings', DEF);
let library = (() => { try { return JSON.parse(localStorage.getItem('lw.library')) || []; } catch (e) { return []; } })();

const st = {
  doc: null,        // {id,url,title,site,lang,blocks,date,pos,total}
  sents: [],        // [{text, el}]
  idx: 0,
  playing: false,
  gen: 0,
  voices: [],
  wake: null,
  sleepAt: 0
};

/* ---------------- utilità ---------------- */
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function status(msg, kind) {
  const el = $('#status');
  if (!msg) { el.classList.add('hidden'); return; }
  el.className = 'status' + (kind === 'err' ? ' err' : '');
  el.innerHTML = (kind === 'load' ? '<div class="spin"></div>' : '') + '<div>' + msg + '</div>';
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function fetchT(url, opt = {}, ms = 20000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  return fetch(url, Object.assign({}, opt, { signal: c.signal })).finally(() => clearTimeout(t));
}
function normUrl(s) {
  s = (s || '').trim();
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) return m[0].replace(/[)\].,;]+$/, '');
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return 'https://' + s;
  return '';
}

/* ---------------- riconoscimento lingua ---------------- */
const SW = {
  it: ['il', 'lo', 'gli', 'della', 'delle', 'degli', 'dello', 'che', 'non', 'per', 'sono', 'è', 'nel', 'nella', 'con', 'una', 'di', 'del', 'anche', 'questo', 'questa', 'più', 'come', 'ma', 'alla', 'alle', 'dei', 'ha', 'hanno', 'essere', 'stato', 'ci', 'si', 'già', 'perché', 'quando', 'molto', 'tra', 'fra', 'sul', 'sulla', 'ed', 'poi', 'ancora', 'cosa', 'tutti', 'dopo'],
  es: ['el', 'los', 'las', 'del', 'que', 'y', 'es', 'por', 'una', 'con', 'para', 'como', 'más', 'pero', 'sus', 'está', 'también', 'muy', 'al', 'se', 'lo', 'su', 'fue', 'han', 'hay', 'este', 'esta', 'entre', 'cuando', 'desde', 'sobre', 'todo', 'ya', 'porque', 'ser', 'son', 'sin', 'hasta', 'donde', 'después', 'año', 'nos', 'pueden', 'cómo', 'qué']
};
function detectLang(text, hint) {
  const sample = text.slice(0, 6000).toLowerCase();
  const words = sample.match(/[a-záéíóúàèìòùñü]+/g) || [];
  const sets = { it: new Set(SW.it), es: new Set(SW.es) };
  let it = 0, es = 0;
  for (const w of words) { if (sets.it.has(w)) it++; if (sets.es.has(w)) es++; }
  es += ((sample.match(/[ñ¿¡]/g) || []).length) * 3 + ((sample.match(/ción\b|ciones\b/g) || []).length) * 2;
  it += ((sample.match(/[àèìòù]/g) || []).length) + ((sample.match(/zione\b|zioni\b|gli\b/g) || []).length) * 2;
  if (it + es < 6 && hint) { const h = hint.toLowerCase(); if (h.startsWith('es')) return 'es'; if (h.startsWith('it')) return 'it'; }
  return es > it ? 'es' : 'it';
}

/* ---------------- estrazione del testo ---------------- */
function cleanMd(md) {
  const out = [];
  let inCode = false;
  for (let raw of md.split(/\r?\n/)) {
    let l = raw.trim();
    if (/^```/.test(l)) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (!l) { out.push(null); continue; }
    if (/^([=\-*_]\s*){3,}$/.test(l)) continue;           // righe separatrici
    if (/^\|?\s*:?-{2,}/.test(l)) continue;                // separatori tabella
    let type = 'p';
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { type = 'h'; l = h[2]; }
    else if (/^[-*+•]\s+/.test(l)) { type = 'li'; l = l.replace(/^[-*+•]\s+/, ''); }
    else if (/^\d+[.)]\s+/.test(l)) { type = 'li'; }
    else if (/^>\s?/.test(l)) { type = 'q'; l = l.replace(/^>\s?/, ''); }
    l = l
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                // immagini
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1') // link → testo
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s*\|\s*/g, ' · ').replace(/^·\s*|\s*·$/g, '')
      .replace(/\s{2,}/g, ' ').trim();
    if (!/[a-zà-ÿ]{2}/i.test(l)) continue;
    out.push({ t: type, text: l });
  }
  // unisce righe dello stesso paragrafo spezzate a capo
  const blocks = [];
  let prevNull = true;
  for (const b of out) {
    if (b === null) { prevNull = true; continue; }
    const last = blocks[blocks.length - 1];
    if (!prevNull && last && last.t === 'p' && b.t === 'p' && !/[.!?:»"]$/.test(last.text)) last.text += ' ' + b.text;
    else blocks.push(b);
    prevNull = false;
  }
  return dropJunk(blocks);
}

// toglie menu, briciole, "condividi", ecc. (blocchi corti in sequenza)
function dropJunk(blocks) {
  const junk = /^(menu|cerca|search|condividi|share|compartir|iscriviti|suscríbete|accedi|login|cookie|privacy|leggi anche|lee también|pubblicità|publicidad|advertisement|torna su|skip to)/i;
  const res = blocks.filter(b => {
    const w = b.text.split(/\s+/).length;
    if (junk.test(b.text) && w < 12) return false;
    if (b.t === 'li' && w < 3) return false;
    if (b.t === 'p' && w < 3 && !/[.!?]$/.test(b.text)) return false;
    const segs = b.text.split(' · ');
    if (segs.length > 1 && w / segs.length < 3.5) return false; // barre di menu tipo "Home · Notizie · Sport"
    return true;
  });
  return res;
}

function extractHtml(html, url) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const meta = n => (d.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || '';
  const title = meta('og:title') || (d.querySelector('h1') || {}).textContent || d.title || hostOf(url);
  const lang = d.documentElement.getAttribute('lang') || meta('og:locale');
  d.querySelectorAll('script,style,noscript,nav,footer,header,aside,form,iframe,svg,button,select,figure,[role=navigation],[aria-hidden=true],.share,.social,.related,.comments,#comments,.newsletter,.cookie,.ad,.ads,.advert').forEach(e => e.remove());
  let root = d.querySelector('article') || d.querySelector('[itemprop=articleBody]') || d.querySelector('main') || d.querySelector('[role=main]');
  if (!root || root.textContent.trim().length < 400) {
    // contenitore con più testo nei paragrafi
    const score = new Map();
    d.querySelectorAll('p').forEach(p => {
      const len = p.textContent.trim().length;
      if (len < 40) return;
      const par = p.parentElement; if (!par) return;
      score.set(par, (score.get(par) || 0) + len);
      const gp = par.parentElement; if (gp) score.set(gp, (score.get(gp) || 0) + len * 0.4);
    });
    let best = null, bs = 0;
    score.forEach((v, k) => { if (v > bs) { bs = v; best = k; } });
    root = best || d.body;
  }
  const blocks = [];
  root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre').forEach(el => {
    if (el.closest('li') && el.tagName !== 'LI') return;
    if (el.tagName === 'P' && el.closest('blockquote')) return;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (!/[a-zà-ÿ]{2}/i.test(text)) return;
    const t = /^H/.test(el.tagName) ? 'h' : el.tagName === 'LI' ? 'li' : el.tagName === 'BLOCKQUOTE' ? 'q' : 'p';
    blocks.push({ t, text });
  });
  if (!blocks.length) {
    root.textContent.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 30).forEach(text => blocks.push({ t: 'p', text }));
  }
  return { title: title.trim(), lang, blocks: dropJunk(blocks) };
}

async function viaJina(url) {
  const r = await fetchT('https://r.jina.ai/' + url, { headers: { 'Accept': 'text/plain' } }, 30000);
  if (!r.ok) throw new Error('jina ' + r.status);
  const txt = await r.text();
  let title = '', body = txt;
  const mt = txt.match(/^Title:\s*(.*)$/m); if (mt) title = mt[1].trim();
  const i = txt.indexOf('Markdown Content:');
  if (i >= 0) body = txt.slice(i + 17);
  const blocks = cleanMd(body);
  if (blocks.reduce((n, b) => n + b.text.length, 0) < 200) throw new Error('poco testo');
  return { title, lang: '', blocks };
}
async function viaProxy(url) {
  const proxies = [
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u)
  ];
  let lastErr;
  for (const p of proxies) {
    try {
      const r = await fetchT(p(url), {}, 20000);
      if (!r.ok) throw new Error('proxy ' + r.status);
      const html = await r.text();
      const res = extractHtml(html, url);
      if (res.blocks.reduce((n, b) => n + b.text.length, 0) < 200) throw new Error('poco testo');
      return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('proxy');
}

async function openUrl(url) {
  url = normUrl(url);
  if (!url) { toast('Indirizzo non valido'); return; }
  const known = library.find(d => d.url === url);
  if (known) { openDoc(known); toast('Ripreso dalla libreria'); return; }
  stop();
  $('#btnOpen').disabled = true;
  status('Apro la pagina e preparo il testo…', 'load');
  try {
    let res;
    try { res = await viaJina(url); }
    catch (e) { status('Provo un altro metodo di lettura…', 'load'); res = await viaProxy(url); }
    const all = res.blocks.map(b => b.text).join(' ');
    const doc = {
      id: 'd' + Date.now().toString(36),
      url, site: hostOf(url),
      title: res.title || hostOf(url),
      lang: chooseLang(res.title + ' ' + all, res.lang),
      blocks: res.blocks, date: Date.now(), pos: 0
    };
    status('');
    addToLibrary(doc);
    openDoc(doc);
  } catch (e) {
    console.warn(e);
    status('Non riesco a leggere questa pagina (potrebbe essere protetta o richiedere l\'accesso).<br>Puoi aprirla nel browser, copiare il testo e usare <b>Incolla testo</b>.', 'err');
  } finally { $('#btnOpen').disabled = false; }
}

function openText(text) {
  text = text.trim();
  if (text.length < 2) { toast('Incolla prima un testo'); return; }
  stop();
  const blocks = text.split(/\n\s*\n|\n(?=[A-ZÀ-Ý¿¡])/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).map(t => ({ t: 'p', text: t }));
  const first = blocks[0].text;
  const doc = {
    id: 'd' + Date.now().toString(36), url: '', site: 'Testo incollato',
    title: first.length > 70 ? first.slice(0, 67).replace(/\s\S*$/, '') + '…' : first,
    lang: chooseLang(text), blocks, date: Date.now(), pos: 0
  };
  addToLibrary(doc);
  openDoc(doc);
}

/* ---------------- frasi ---------------- */
function splitSentences(text, lang) {
  let parts;
  if (window.Intl && Intl.Segmenter) {
    parts = Array.from(new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text), s => s.segment);
  } else {
    parts = text.match(/[^.!?…]+(?:[.!?…]+["»”')\]]*|$)\s*/g) || [text];
  }
  const res = [];
  for (let p of parts) {
    p = p.trim(); if (!p) continue;
    // frasi lunghe: spezza su punteggiatura debole (alcune voci si fermano dopo ~15 s)
    while (p.length > 230) {
      let cut = -1;
      const zone = p.slice(80, 230);
      const m = [...zone.matchAll(/[,;:–—)]\s/g)].pop();
      if (m) cut = 80 + m.index + 1;
      else { cut = p.lastIndexOf(' ', 220); if (cut < 60) cut = 220; }
      res.push(p.slice(0, cut).trim()); p = p.slice(cut).trim();
    }
    if (p) res.push(p);
  }
  return res;
}

/* ---------------- visualizzazione ---------------- */
function openDoc(doc) {
  stop();
  st.doc = doc;
  $('#empty').classList.add('hidden');
  $('#reader').classList.remove('hidden');
  $('#player').classList.remove('hidden');
  $('#docTitle').textContent = doc.title;
  $('#docSite').textContent = doc.site || '';
  renderDoc();
  setLangButtons();
  switchView('leggi');
  const pos = Math.min(doc.pos || 0, st.sents.length - 1);
  st.idx = Math.max(0, pos);
  markProgress();
  if (pos > 0) {
    toast('Riprendo da dove eri arrivato');
    setTimeout(() => scrollToSent(st.idx, true), 150);
  } else window.scrollTo({ top: $('#reader').offsetTop - 70, behavior: 'smooth' });
}

function renderDoc() {
  const body = $('#docBody');
  body.innerHTML = '';
  st.sents = [];
  const lang = st.doc.lang;
  let list = null;
  for (const b of st.doc.blocks) {
    const tag = b.t === 'h' ? 'h3' : b.t === 'li' ? 'li' : b.t === 'q' ? 'blockquote' : 'p';
    if (tag === 'li') { if (!list) { list = document.createElement('ul'); body.appendChild(list); } }
    else list = null;
    const el = document.createElement(tag);
    for (const s of splitSentences(b.text, lang)) {
      const sp = document.createElement('span');
      sp.className = 's';
      sp.dataset.i = st.sents.length;
      sp.textContent = s + ' ';
      el.appendChild(sp);
      st.sents.push({ text: s, el: sp, head: b.t === 'h' });
    }
    (tag === 'li' ? list : body).appendChild(el);
  }
  const words = st.sents.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  st.doc.words = words;
  $('#docInfo').textContent = Math.max(1, Math.round(words / 160)) + ' min di ascolto';
}

$('#docBody').addEventListener('click', e => {
  const s = e.target.closest('.s'); if (!s) return;
  play(+s.dataset.i);
});

function setLangButtons() {
  $$('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === st.doc.lang));
}
$('#langSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !st.doc) return;
  if (st.doc.lang === b.dataset.lang) return;
  const wasPlaying = st.playing;
  st.doc.lang = b.dataset.lang;
  setLangButtons(); persistDoc();
  toast(b.dataset.lang === 'es' ? 'Lectura en español' : 'Lettura in italiano');
  if (wasPlaying) play(st.idx);
});

function markProgress() {
  const n = st.sents.length;
  st.sents.forEach((s, i) => { s.el.classList.toggle('read', i < st.idx); s.el.classList.toggle('cur', i === st.idx && (st.playing || st.idx > 0)); });
  $('#pPos').textContent = n ? (st.idx + 1) + ' / ' + n : '0 / 0';
  $('#progBar').style.width = n ? ((st.idx) / n * 100) + '%' : '0';
  const left = st.sents.slice(st.idx).reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  const min = Math.round(left / (160 * settings.rate));
  $('#pLeft').textContent = st.sleepAt ? '⏾ ' + Math.max(0, Math.ceil((st.sleepAt - Date.now()) / 60000)) + ' min' : (min < 1 ? '< 1 min' : min + ' min');
}
function highlight(i) {
  const prev = $('.s.cur'); if (prev) prev.classList.remove('cur');
  st.sents.forEach((s, k) => s.el.classList.toggle('read', k < i));
  if (st.sents[i]) st.sents[i].el.classList.add('cur');
  markProgress();
  if (settings.follow) scrollToSent(i);
}
function scrollToSent(i, force) {
  const s = st.sents[i]; if (!s) return;
  const r = s.el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (force || r.top < 90 || r.bottom > vh - 150) window.scrollBy({ top: r.top - vh * 0.32, behavior: 'smooth' });
}

/* ---------------- voci ---------------- */
function langOf(v) { return (v.lang || '').replace('_', '-').toLowerCase(); }
function loadVoices() {
  st.voices = synth ? synth.getVoices() : [];
  fillVoiceSelect('#selVoiceIt', 'it', 'voiceIt');
  fillVoiceSelect('#selVoiceEs', 'es', 'voiceEs');
  const miss = ['it', 'es'].filter(l => !st.voices.some(v => langOf(v).startsWith(l)));
  const w = $('#voiceWarn');
  if (!synth) { w.textContent = 'Questo browser non supporta la lettura vocale. Usa Chrome, Edge o Safari aggiornati.'; w.classList.remove('hidden'); }
  else if (st.voices.length && miss.length) {
    w.innerHTML = 'Non trovo una voce ' + miss.map(l => l === 'it' ? '<b>italiana</b>' : '<b>spagnola</b>').join(' e ') +
      ' sul dispositivo. Su Android: <i>Impostazioni → Sistema → Lingue → Output sintesi vocale → Motore Google → Installa dati vocali</i>. Su iPhone: <i>Impostazioni → Accessibilità → Contenuto letto → Voci</i>.';
    w.classList.remove('hidden');
  } else w.classList.add('hidden');
}
function fillVoiceSelect(sel, lang, key) {
  const el = $(sel);
  const list = st.voices.filter(v => langOf(v).startsWith(lang))
    .sort((a, b) => score(b, lang) - score(a, lang));
  el.innerHTML = '<option value="">Automatica (consigliata)</option>' +
    list.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}${v.localService ? '' : ' · online'}</option>`).join('');
  el.value = list.some(v => v.voiceURI === settings[key]) ? settings[key] : '';
}
function score(v, lang) {
  const l = langOf(v); const n = v.name.toLowerCase();
  let s = 0;
  if (l === (lang === 'it' ? 'it-it' : 'es-es')) s += 4;
  if (/natural|neural|premium|enhanced|google/.test(n)) s += 3;
  if (/online/.test(n)) s += 1;
  if (v.localService) s += 1;
  return s;
}
function pickVoice(lang) {
  const key = lang === 'es' ? 'voiceEs' : 'voiceIt';
  const list = st.voices.filter(v => langOf(v).startsWith(lang));
  return list.find(v => v.voiceURI === settings[key]) || list.sort((a, b) => score(b, lang) - score(a, lang))[0] || null;
}
if (synth) {
  loadVoices();
  synth.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 800); setTimeout(loadVoices, 2500);
}

/* ---------------- lettura ---------------- */
function speakAt(i) {
  const g = ++st.gen;
  if (!st.doc || i >= st.sents.length) { finished(); return; }
  if (i < 0) i = 0;
  st.idx = i;
  highlight(i);
  persistPos();
  if (st.sleepAt && Date.now() >= st.sleepAt) { pause(); st.sleepAt = 0; toast('Timer scaduto: lettura in pausa'); return; }

  const lang = st.doc.lang;
  const u = new SpeechSynthesisUtterance(st.sents[i].text);
  u.lang = lang === 'es' ? 'es-ES' : 'it-IT';
  const v = pickVoice(lang); if (v) { try { u.voice = v; u.lang = v.lang; } catch (e) { /* voce non valida */ } }
  u.rate = settings.rate; u.pitch = settings.pitch;
  let done = false;
  const next = () => {
    if (done || g !== st.gen || !st.playing) return;
    done = true;
    setTimeout(() => { if (g === st.gen && st.playing) speakAt(i + 1); }, st.sents[i].head ? 350 : 40);
  };
  u.onend = next;
  u.onerror = e => {
    if (g !== st.gen) return;
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    console.warn('TTS', e.error);
    if (e.error === 'not-allowed') { pause(); toast('Tocca ▶ per avviare la lettura'); return; }
    next();
  };
  synth.speak(u);
  // alcune versioni di Chrome non avviano se la coda è "in pausa"
  if (synth.paused) synth.resume();
}

function play(from) {
  if (!synth) { toast('Lettura vocale non supportata da questo browser'); return; }
  if (!st.doc) return;
  if (typeof from !== 'number') from = st.idx >= st.sents.length ? 0 : st.idx;
  st.playing = true;
  setPlayIcon();
  bgStart(); wakeOn();
  st.gen++;
  if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(() => speakAt(from), 120); }
  else speakAt(from);
}
function pause() {
  st.playing = false; st.gen++;
  if (synth) synth.cancel();
  setPlayIcon(); bgStop(); wakeOff();
  markProgress(); flushPos();
}
function stop() { if (st.playing) pause(); }
function finished() {
  st.playing = false; setPlayIcon(); bgStop(); wakeOff();
  st.idx = st.sents.length; persistPos(); markProgress();
  $('#progBar').style.width = '100%';
  const c = $('.s.cur'); if (c) c.classList.remove('cur');
  toast(st.doc && st.doc.lang === 'es' ? 'Lectura terminada' : 'Lettura terminata');
  st.idx = 0;
}
function setPlayIcon() {
  $('#icoPlay').classList.toggle('hidden', st.playing);
  $('#icoPause').classList.toggle('hidden', !st.playing);
  $('#btnPlay').setAttribute('aria-label', st.playing ? 'Pausa' : 'Leggi');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused';
}
function step(d) {
  if (!st.doc) return;
  const i = Math.max(0, Math.min(st.sents.length - 1, st.idx + d));
  if (st.playing) play(i); else { st.idx = i; highlight(i); persistPos(); }
}

$('#btnPlay').onclick = () => st.playing ? pause() : play();
$('#btnPrev').onclick = () => step(-1);
$('#btnNext').onclick = () => step(1);
$('.progress').onclick = e => {
  if (!st.sents.length) return;
  const r = e.currentTarget.getBoundingClientRect();
  const i = Math.floor((e.clientX - r.left) / r.width * st.sents.length);
  if (st.playing) play(i); else { st.idx = i; highlight(i); persistPos(); }
};
const RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
$('#btnRate').onclick = () => {
  const i = RATES.findIndex(r => r >= settings.rate - 0.001);
  settings.rate = RATES[(i + 1) % RATES.length];
  saveSettings(); applySettingsUI();
  if (st.playing) play(st.idx);
};

/* tastiera (PC): spazio = play/pausa, frecce = frase prec./succ. */
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('#dlgSettings').open || !st.doc) return;
  if (e.code === 'Space') { e.preventDefault(); st.playing ? pause() : play(); }
  if (e.code === 'ArrowRight') step(1);
  if (e.code === 'ArrowLeft') step(-1);
});

/* schermo acceso durante la lettura */
async function wakeOn() { try { if ('wakeLock' in navigator && !st.wake) { st.wake = await navigator.wakeLock.request('screen'); st.wake.onrelease = () => { st.wake = null; }; } } catch (e) { /* no */ } }
function wakeOff() { try { if (st.wake) st.wake.release(); } catch (e) { /* no */ } st.wake = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && st.playing) wakeOn(); });

/* audio silenzioso + Media Session: aiuta a continuare in sottofondo
   e mostra i comandi sulla schermata di blocco */
let bgAudio = null;
function silentWav() {
  const sr = 8000, n = sr * 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function bgStart() {
  if (!settings.bg) return;
  try {
    if (!bgAudio) { bgAudio = new Audio(silentWav()); bgAudio.loop = true; bgAudio.volume = 0.01; }
    bgAudio.play().catch(() => {});
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: st.doc.title, artist: 'LeggiWeb · ' + (st.doc.lang === 'es' ? 'Español' : 'Italiano'), album: st.doc.site || '',
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => play());
      ms.setActionHandler('pause', () => pause());
      try { ms.setActionHandler('stop', () => pause()); } catch (e) { /* no */ }
      ms.setActionHandler('previoustrack', () => step(-1));
      ms.setActionHandler('nexttrack', () => step(1));
    }
  } catch (e) { /* no */ }
}
function bgStop() { try { if (bgAudio) bgAudio.pause(); } catch (e) { /* no */ } }

/* Chrome desktop: a volte la sintesi si "addormenta" su testi lunghi */
setInterval(() => { if (st.playing && synth && synth.paused) synth.resume(); }, 5000);
setInterval(() => { if (st.doc) markProgress(); }, 30000);

/* ---------------- libreria ---------------- */
function addToLibrary(doc) {
  library = library.filter(d => d.url ? d.url !== doc.url : d.id !== doc.id);
  library.unshift(doc);
  if (library.length > 40) library.length = 40;
  saveLibrary(); renderLibrary();
}
function saveLibrary() {
  while (!save('lw.library', library) && library.length > 1) library.pop(); // spazio pieno: toglie le più vecchie
}
function persistDoc() { if (!st.doc) return; const d = library.find(x => x.id === st.doc.id); if (d) { d.lang = st.doc.lang; saveLibrary(); } }
let posTimer;
function persistPos() {
  if (!st.doc) return;
  st.doc.pos = st.idx; st.doc.total = st.sents.length; st.doc.date = Date.now();
  clearTimeout(posTimer); posTimer = setTimeout(() => { saveLibrary(); renderLibrary(); }, 800);
}
function flushPos() { clearTimeout(posTimer); if (st.doc) { saveLibrary(); renderLibrary(); } }
window.addEventListener('pagehide', flushPos);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPos(); });

function renderLibrary() {
  const ul = $('#libList');
  $('#libCount').textContent = library.length || '';
  $('#libEmpty').classList.toggle('hidden', library.length > 0);
  $('#btnClearLib').classList.toggle('hidden', !library.length);
  ul.innerHTML = library.map(d => {
    const pct = d.total ? Math.round(Math.min(d.pos, d.total) / d.total * 100) : 0;
    const when = new Date(d.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    return `<li class="lib-item" data-id="${d.id}">
      <span class="lib-flag">${d.lang === 'es' ? '🇪🇸' : '🇮🇹'}</span>
      <div class="lib-main"><b>${esc(d.title)}</b><small>${esc(d.site || '')} · ${when}${pct ? ' · ' + pct + '%' : ''}</small>
      <div class="lib-bar"><i style="width:${pct}%"></i></div></div>
      <button class="lib-del" data-del="${d.id}" aria-label="Elimina"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
    </li>`;
  }).join('');
}
$('#libList').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    library = library.filter(d => d.id !== del.dataset.del);
    saveLibrary(); renderLibrary(); return;
  }
  const it = e.target.closest('.lib-item'); if (!it) return;
  const d = library.find(x => x.id === it.dataset.id); if (d) openDoc(d);
});
$('#btnClearLib').onclick = () => {
  if (!confirm('Eliminare tutte le pagine salvate?')) return;
  library = []; saveLibrary(); renderLibrary();
};

/* ---------------- interfaccia ---------------- */
function switchView(v) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
}
$$('.tab').forEach(t => t.onclick = () => switchView(t.dataset.view));

$('#srcSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#srcSeg button').forEach(x => x.classList.toggle('on', x === b));
  $('#formUrl').classList.toggle('hidden', b.dataset.src !== 'url');
  $('#formText').classList.toggle('hidden', b.dataset.src !== 'text');
});
$('#formUrl').onsubmit = e => { e.preventDefault(); openUrl($('#inUrl').value); };
$('#formText').onsubmit = e => { e.preventDefault(); openText($('#inText').value); };
$('#btnPaste').onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    const u = normUrl(t);
    if (u) { $('#inUrl').value = u; openUrl(u); } else toast('Negli appunti non c\'è un link');
  } catch (e) { toast('Tieni premuto nel campo e scegli Incolla'); $('#inUrl').focus(); }
};

/* impostazioni */
function saveSettings() { save('lw.settings', settings); }
function applySettingsUI() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--font', settings.font + 'px');
  $('#rngRate').value = settings.rate; $('#outRate').textContent = (+settings.rate).toFixed(2).replace(/\.?0+$/, '') + '×';
  $('#btnRate').textContent = (+settings.rate).toFixed(2).replace(/\.?0+$/, '') + '×';
  $('#rngPitch').value = settings.pitch; $('#outPitch').textContent = (+settings.pitch).toFixed(2).replace(/\.?0+$/, '');
  $('#rngFont').value = settings.font; $('#outFont').textContent = settings.font;
  $('#selTheme').value = settings.theme;
  $('#chkAuto').checked = settings.autoLang;
  $('#chkFollow').checked = settings.follow;
  $('#chkBg').checked = settings.bg;
  $('#selSleep').value = String(settings.sleep || 0);
}
$('#btnSettings').onclick = () => { loadVoices(); $('#dlgSettings').showModal(); };
$('#dlgSettings').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#rngRate').oninput = e => { settings.rate = +e.target.value; saveSettings(); applySettingsUI(); };
$('#rngRate').onchange = () => { if (st.playing) play(st.idx); };
$('#rngPitch').oninput = e => { settings.pitch = +e.target.value; saveSettings(); applySettingsUI(); };
$('#rngPitch').onchange = () => { if (st.playing) play(st.idx); };
$('#rngFont').oninput = e => { settings.font = +e.target.value; saveSettings(); applySettingsUI(); };
$('#selTheme').onchange = e => { settings.theme = e.target.value; saveSettings(); applySettingsUI(); };
$('#chkAuto').onchange = e => { settings.autoLang = e.target.checked; saveSettings(); };
$('#chkFollow').onchange = e => { settings.follow = e.target.checked; saveSettings(); };
$('#chkBg').onchange = e => { settings.bg = e.target.checked; saveSettings(); if (!settings.bg) bgStop(); else if (st.playing) bgStart(); };
$('#selSleep').onchange = e => {
  settings.sleep = +e.target.value; saveSettings();
  st.sleepAt = settings.sleep ? Date.now() + settings.sleep * 60000 : 0;
  if (st.sleepAt) toast('La lettura si fermerà tra ' + settings.sleep + ' minuti');
  markProgress();
};
$('#selVoiceIt').onchange = e => { settings.voiceIt = e.target.value; saveSettings(); if (st.playing && st.doc.lang === 'it') play(st.idx); };
$('#selVoiceEs').onchange = e => { settings.voiceEs = e.target.value; saveSettings(); if (st.playing && st.doc.lang === 'es') play(st.idx); };
$$('[data-test]').forEach(b => b.onclick = () => {
  if (!synth) return;
  const lang = b.dataset.test;
  if (st.playing) pause();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(lang === 'es' ? 'Hola, soy la voz que leerá tus páginas en español.' : 'Ciao, sono la voce che leggerà le tue pagine in italiano.');
  u.lang = lang === 'es' ? 'es-ES' : 'it-IT';
  const v = pickVoice(lang); if (v) { try { u.voice = v; u.lang = v.lang; } catch (e) { /* voce non valida */ } }
  u.rate = settings.rate; u.pitch = settings.pitch;
  synth.speak(u);
});

/* ricorda l'ultima lingua scelta a mano (usata se il riconoscimento automatico è spento) */
$('#langSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { settings.lastLang = b.dataset.lang; saveSettings(); } });
function chooseLang(text, hint) { return settings.autoLang ? detectLang(text, hint) : (settings.lastLang || 'it'); }

/* ---------------- avvio ---------------- */
$('#verNum').textContent = (window.AppUpdate && window.AppUpdate.current) || '';
settings.sleep = 0; // il timer parte solo quando lo scegli
applySettingsUI();
renderLibrary();

// condivisione da altre app (Android: Condividi → LeggiWeb) o ?url=
(function fromShare() {
  const q = new URLSearchParams(location.search);
  const u = normUrl(q.get('url') || '') || normUrl(q.get('text') || '') || normUrl(q.get('title') || '');
  const txt = (q.get('text') || '').trim();
  if (q.has('url') || q.has('text') || q.has('title')) history.replaceState(null, '', location.pathname);
  if (u) { $('#inUrl').value = u; openUrl(u); }
  else if (txt.length > 40) { openText(txt); }
  else if (library[0] && library[0].pos > 0 && library[0].pos < (library[0].total || 1e9)) {
    // riapre l'ultima lettura lasciata a metà
    openDoc(library[0]);
  }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeunload', () => { if (synth) synth.cancel(); });
