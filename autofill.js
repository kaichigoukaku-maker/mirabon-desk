/* 診ラボン自動入力（ブックマークレットの本体）2026-10-18 ローダー方式
   正本：supabase/functions/app/autofill.js → deploy_app.sh が pages-repo/autofill.js にコピーして公開
   公開先：https://kaichigoukaku-maker.github.io/mirabon-desk/autofill.js
   ブックマーク「診ラボン自動入力」は、このファイルをその場で読み込んで実行する短いローダー（index.html の mirabonLoader）。
   そのため、このファイルを直して公開すれば、利用者がブックマークを登録し直さなくても全員が最新になる。
   クリニックのページ（アプリの外）で動く。確度の高い欄だけ入れる（緑）／迷う欄は入れて黄色／判断できない欄は入れずに赤枠。
   院が違う・営業お断りの記載がある時は何も入れずに止まる。送信ボタンは押さない。
   データはこのタブを開いた文面アプリに postMessage で頼む（予備：クリップボード→貼り付け）。
   変更したら supabase/tests/autofill/run_autofill_forms.mjs で送り先フォームを総当たりし、画面テスト run_app_test.mjs も通す。
   旧版：20260827_問い合わせDM自動化/3_フォーム自動入力.js */
(function mirabonFill(){
  'use strict';
  var PATIENT = /生年月日|誕生日|症状|既往|診察券|保険証|希望日|来院|予約|時間帯|性別|年齢|お薬|服用|受診|患者|カルテ|紹介状|治療歴|身長|体重/;
  var FAX = /fax|ＦＡＸ|ファクス|ファックス/i;
  var AGREE = /同意|承諾|承知|プライバシー|個人情報|規約|privacy|agree|accept/i;
  var NG = /(営業|セールス|売り込み|勧誘|広告)[^。\n]{0,20}(お断り|ご遠慮|禁止|受け付けて(おり)?(ません|いません)|対応(いた)?(しかね|でき)ません)/;
  var COL = { H:['#0f766e','#e6f4f1'], M:['#b45309','#fff7e0'], L:['#dc2626','#fff1f1'] };

  function base(h){ h = (h||'').toLowerCase().replace(/^www\./,''); return (h==='forms.gle') ? 'docs.google.com' : h; }
  function text(el){ return (el && el.textContent || '').replace(/\s+/g,' ').trim(); }
  /* 項目名を探す。入力欄のすぐ前（同じ枠の中）→ 枠の前、の順に近いものから。
     枠の中に別の入力欄があったらそれ以上は上らない（隣の欄の項目名を拾って1つずれるのを防ぐ） */
  var FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select';
  function nFields(node, el){
    var n = 0, names = {};
    [].slice.call(node.querySelectorAll(FIELD)).forEach(function(f){
      if ((f.type==='radio' || f.type==='checkbox') && f.name && f.name===el.name) { if (names[f.name]) return; names[f.name] = 1; }
      n++;
    });
    return n;
  }
  function nearLabel(el){
    var node = el;
    for (var depth = 0; depth < 5 && node && node !== el.ownerDocument.body; depth++) {
      var sib = node.previousElementSibling;
      while (sib && (sib.tagName==='BR' || !text(sib))) sib = sib.previousElementSibling;
      if (sib && !sib.querySelector(FIELD) && text(sib).length < 60 && !/^(SCRIPT|STYLE)$/.test(sib.tagName)) return text(sib);
      var parent = node.parentElement;
      if (!parent || nFields(parent, el) > 1) {
        /* 枠に複数の欄がある＝表の行(th)以外は上らない */
        var tr = el.closest('tr'); if (tr && tr.querySelector('th') && nFields(tr, el) <= 3) return text(tr.querySelector('th'));
        return '';
      }
      node = parent;
    }
    return '';
  }
  function labelOf(el){
    var bits = [];
    if (el.id) { var l = el.ownerDocument.querySelector('label[for="'+CSS.escape(el.id)+'"]'); if (l) bits.push(text(l)); }
    var p = el.closest('label'); if (p) bits.push(text(p));
    if (!bits.length) bits.push(nearLabel(el));
    var fs = el.closest('fieldset'); if (fs && fs.querySelector('legend') && nFields(fs, el) <= 3) bits.push(text(fs.querySelector('legend')));
    bits.push(el.getAttribute('aria-label')||'', el.placeholder||'');
    return bits.join(' ').replace(/\s+/g,' ').trim().slice(0,160);
  }
  /* 内部名は弱い手がかり。フォーム部品の名前に紛れた語（mailform等）は消してから見る */
  function attrsOf(el){ return [el.name||'', el.id||'', el.getAttribute('autocomplete')||''].join(' ').replace(/mail_?form|form_?mail|mailer|contact_?form|form_?record|wpcf7/ig,' '); }
  function req(el, lab){ return el.required || el.getAttribute('aria-required')==='true' || /必須|※|\*|required/i.test(lab+' '+attrsOf(el)+' '+(el.className||'')); }
  function visible(el){ return !el.disabled && el.offsetParent !== null && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden'; }
  function kindOf(el, lab){ var k = kindBy(el, lab) || kindBy(el, attrsOf(el)); if (el.tagName==='TEXTAREA') return k==='patient' ? k : 'body'; return k; }
  function kindBy(el, lab){
    var t = (el.type||'').toLowerCase(), ac = (el.getAttribute('autocomplete')||'').toLowerCase();
    if (PATIENT.test(lab)) return 'patient';
    if (FAX.test(lab)) return 'fax';
    if (/ふりがな|フリガナ|ﾌﾘｶﾞﾅ|かな|カナ|kana|furigana|ruby|yomi|^(せい|めい|セイ|メイ)$/i.test(lab)) return 'kana';
    if (t==='email' || /メール|e-?mail|mail/i.test(lab) || ac==='email') return 'email';
    if (t==='tel' || /電話|tel|phone|携帯/i.test(lab) || /^tel/.test(ac)) return 'tel';
    if (/郵便|〒|zip|postal/i.test(lab) || ac==='postal-code') return 'zip';
    if (/住所|所在地|address|市区町村|番地|都道府県/i.test(lab)) return 'addr';
    if (/会社|法人|企業|所属|団体|組織|貴社|御社|company|organization/i.test(lab)) return 'company';
    if (/件名|題名|タイトル|subject|title/i.test(lab)) return 'subject';
    if (/お?名前|氏名|ご担当|担当者|芳名|name|^姓|^名|sei|mei/i.test(lab) || /^(family|given)?-?name$/.test(ac)) return 'name';
    if (/内容|本文|ご質問|ご相談|メッセージ|message|inquiry|comment|ご要望|詳細/i.test(lab)) return 'body';
    return '';
  }
  /* 入力イベントの発火：古いサイト（MooTools 1.2 等）は window.Event を自前のクラスで上書きしていて new Event() がサイト側で落ちる。
     上書きされない document.createEvent で作る（同じ input/change の bubbles 付きイベント） */
  function fire(el, type){
    var ev; var doc = el.ownerDocument;
    try { ev = doc.createEvent('Event'); ev.initEvent(type, true, true); } catch(e) { ev = new Event(type, { bubbles:true }); }
    el.dispatchEvent(ev);
  }
  function setValue(el, v){
    var w = el.ownerDocument.defaultView, proto = el.tagName==='TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, v);
    fire(el, 'input'); fire(el, 'change');
  }
  function mark(el, tier){ var c = COL[tier]; el.style.outline = '3px solid '+c[0]; el.style.outlineOffset = '1px'; if (tier!=='L') el.style.background = c[1]; }

  /* データの受け取り：①このタブを開いた文面アプリに頼む（許可不要）②だめならクリップボード（許可を聞かれる）③貼り付け */
  function getPayload(cb){
    var ask = function(){ var t = window.prompt('診ラボン｜自動入力データを貼り付けてください（⌘V → Enter）',''); if (t) cb(t); };
    var clip = function(){
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function(t){ if (t && t.indexOf('"__mirabon":2')>=0) cb(t); else ask(); })['catch'](ask);
      } else ask();
    };
    var op = null; try { op = window.opener; } catch(e) {}
    if (!op) { clip(); return; }
    var done = false;
    var onMsg = function(e){
      if (e.source !== op || !e.data || e.data.__mirabonRes !== 2) return;
      if (e.origin !== 'https://kaichigoukaku-maker.github.io' && e.origin !== 'null') return;
      done = true; window.removeEventListener('message', onMsg);
      if (e.data.error) { alert('診ラボン自動入力：' + e.data.error); return; }
      cb(e.data.data);
    };
    window.addEventListener('message', onMsg);
    try { op.postMessage({ __mirabonReq:2 }, '*'); } catch(e) {}
    setTimeout(function(){ if (!done) { window.removeEventListener('message', onMsg); clip(); } }, 800);
  }

  function run(raw){ try { run2(raw); } catch(e) { alert('診ラボン自動入力でエラーが出ました（'+e.message+'）。\n「本文をコピー」で貼り付けてください。'); } }
  function run2(raw){
    /* 古いサイト（MooTools 1.2 等）は window.JSON を別物で上書きしている。そのときは空の枠から本物の JSON.parse を借りる */
    var parse = function(t){
      if (window.JSON && typeof JSON.parse === 'function' && /native code/.test(Function.prototype.toString.call(JSON.parse))) return JSON.parse(t);
      var fr = document.createElement('iframe'); fr.style.display = 'none'; (document.body||document.documentElement).appendChild(fr);
      try { return fr.contentWindow.JSON.parse(t); } finally { fr.parentNode.removeChild(fr); }
    };
    var d; try { d = parse(raw); } catch(e) { alert('データの形式が違います。文面アプリ③で「自動入力データをコピー」を押し直してください。'); return; }
    if (d.__mirabon !== 2) { alert('古い形式のデータです。文面アプリ③で「自動入力データをコピー」を押し直してください。'); return; }

    /* ---- ページ単位の判定（ここで止まったら何も入れない） ---- */
    if (base(location.hostname) !== base(d.host) && !base(location.hostname).endsWith('.'+base(d.host)) && !base(d.host).endsWith('.'+base(location.hostname))) {
      alert('【止めました】院が違う可能性があります\n\nコピーしたデータ：'+d.clinic+'（'+d.host+'）\nいま開いているページ：'+location.hostname+'\n\n文面アプリ③で、この院の「自動入力データをコピー」を押し直してください。');
      return;
    }
    if (Date.now() - (d.ts||0) > 30*60*1000 && !confirm('コピーしてから30分以上たったデータです（'+d.clinic+'）。\nこのまま入れますか？')) return;
    var ng = ((document.body||document.documentElement).innerText||'').match(NG);
    if (ng && !confirm('【確認】このページに次の記載があります\n\n「'+ng[0]+'」\n\n取材依頼として送るか、人が判断してください。\nOK＝入力を続ける／キャンセル＝止める（文面アプリ③で「送れなかった → お断り記載」）')) return;

    /* ---- フォームを特定（本文欄があって入力欄が一番多いもの） ---- */
    var form = null, best = -1;
    /* 入力欄が無ければ、同じサイト内の埋め込み枠（iframe）の中を探す。別サイトの枠（Googleフォーム等）には入れない */
    var TXT = 'textarea,input:not([type]),input[type=text],input[type=email],input[type=tel]';
    var doc = document;
    if (!doc.querySelector(TXT)) {
      [].slice.call(document.querySelectorAll('iframe')).some(function(fr){
        try { var dd = fr.contentDocument; if (dd && dd.querySelector(TXT)) { doc = dd; return true; } } catch(e) {}
        return false;
      });
    }
    [].slice.call(doc.querySelectorAll('form')).forEach(function(f){
      if (!f.querySelector(TXT)) return;
      var sc = f.querySelectorAll('textarea').length*10 + f.querySelectorAll('input,select').length;
      if (sc > best) { best = sc; form = f; }
    });
    var scope = form || doc;
    if (!scope.querySelector(TXT)) {
      alert('入力欄が見つかりません。\nフォームが別の枠（埋め込み）にある場合は、枠の中をクリックしてからもう一度押すか、「本文をコピー」で貼り付けてください。');
      return;
    }

    var res = { H:[], M:[], L:[], skip:[] };
    function add(tier, el, label, v){ if (el) mark(el, tier); res[tier].push({ el:el, label:label, v:v||'' }); }

    /* ---- テキスト欄を種類ごとに集める ---- */
    var groups = {}, order = [];
    [].slice.call(scope.querySelectorAll('input,textarea')).forEach(function(el){
      var t = (el.type||el.tagName).toLowerCase();
      if (['hidden','submit','button','image','reset','file','radio','checkbox','password'].indexOf(t)>=0) return;
      if (!visible(el) || el.readOnly) return;
      if (/captcha|recaptcha|token/i.test(el.name||'')) return;
      var lab = labelOf(el), k = kindOf(el, lab);
      /* 選択肢の横の「その他（詳細）」欄は、用件の一部なので触らない */
      if (el.tagName!=='TEXTAREA' && el.parentElement && el.parentElement.querySelector('input[type=radio],input[type=checkbox]')) k = '';
      if (el.value && el.value.trim()) { res.skip.push({ el:el, label:'入力済みのため触らず：'+lab.slice(0,20) }); return; }
      if (k==='patient') { res.skip.push({ el:el, label:'患者向けの欄：'+lab.slice(0,20) }); return; }
      if (k==='fax') { res.skip.push({ el:el, label:'FAX（空欄のまま）' }); return; }
      var item = { el:el, lab:lab, req:req(el,lab) };
      if (!k) { order.push(['?', item]); return; }
      if (!groups[k]) { groups[k] = []; order.push([k, groups[k]]); }
      groups[k].push(item);
    });

    var nm = (d.name||'').split(/[\s　]+/), kn = (d.kana||'').split(/[\s　]+/);
    /* ふりがなの表記：欄の指定（ひらがな／カタカナ）→ 入力例の文字 → 項目名の書き方（フリガナ＝カタカナ、ふりがな＝ひらがな）の順で決める */
    function toKata(t){ return t.replace(/[ぁ-ゖ]/g, function(ch){ return String.fromCharCode(ch.charCodeAt(0)+0x60); }); }
    function toHira(t){ return t.replace(/[ァ-ヶ]/g, function(ch){ return String.fromCharCode(ch.charCodeAt(0)-0x60); }); }
    function kanaMode(it){
      var lab = it.lab, ph = it.el.placeholder || '';
      if (/ひらがな/.test(lab)) return 'hira';
      if (/カタカナ|全角カナ/.test(lab)) return 'kata';
      if (/[ァ-ヶ]{2,}/.test(ph)) return 'kata';
      if (/[ぁ-ゖ]{2,}/.test(ph)) return 'hira';
      if (/フリガナ|ﾌﾘｶﾞﾅ|カナ|ｶﾅ|セイ|メイ/.test(lab)) return 'kata';
      if (/ふりがな|せい|めい/.test(lab)) return 'hira';
      return '';
    }
    /* 姓・名に分かれた欄は表記をそろえる（どれかがカタカナを指していればカタカナ） */
    var kanaGroupMode = '';
    function kanaFor(it, v){
      var m = kanaGroupMode || kanaMode(it);
      return m==='kata' ? toKata(v) : m==='hira' ? toHira(v) : v;
    }
    /* 都道府県：住所の先頭から読み取り、都道府県の選択欄があればそこで選ぶ（住所の欄にはそれ以降だけを入れる） */
    var PREF = ((d.addr||'').replace(/^〒?\s*\d{3}-?\d{4}\s*/, '').match(/^(北海道|東京都|京都府|大阪府|.{2,3}県)/) || [])[0] || '';
    var prefSel = [].slice.call(scope.querySelectorAll('select')).filter(function(sel){
      if (!visible(sel)) return false;
      var t = [].slice.call(sel.options).map(function(o){ return o.textContent; }).join(',');
      return /北海道/.test(t) && /沖縄/.test(t);
    })[0] || null;
    var addrRest = (prefSel && PREF) ? (d.addr||'').replace(/^〒?\s*\d{3}-?\d{4}\s*/, '').slice(PREF.length).replace(/^[\s　]+/, '') : (d.addr||'');
    var telp = (d.tel||'').split(/[-－ー‐]/), zipp = (d.zip||'').split(/[-－ー‐]/);
    function splitFill(list, full, parts, label, needAll){
      if (list.length===1) return [[list[0], full]];
      if (list.length===parts.length && parts.length>1) return list.map(function(it,i){ return [it, parts[i]]; });
      return null;
    }
    function trim(el, v){ return (el.maxLength>0 && v.length>el.maxLength) ? null : v; }

    order.forEach(function(o){
      var k = o[0];
      if (k==='?') { var it = o[1]; if (it.req) add('L', it.el, '不明な必須欄：'+it.lab.slice(0,24)); else res.skip.push({ el:it.el, label:'任意の欄（空欄）：'+it.lab.slice(0,20) }); return; }
      var list = o[1];
      if (k==='body') {
        var b0 = list[0]; var v = trim(b0.el, d.body);
        if (v===null) { add('L', b0.el, '本文（文字数制限 '+b0.el.maxLength+'字を超えるため手で短く）'); }
        else { setValue(b0.el, v); add(b0.el.tagName==='TEXTAREA' ? 'H':'M', b0.el, '本文', v); }
        list.slice(1).forEach(function(it){ if (it.req) add('L', it.el, '本文らしき2つ目の欄：'+it.lab.slice(0,20)); });
        return;
      }
      if (k==='email') {
        list.forEach(function(it, i){ setValue(it.el, d.email); add((i===0 || /確認|再入力|confirm|again/i.test(it.lab)) ? 'H':'M', it.el, i===0 ? 'メール' : 'メール（確認用）', d.email); });
        return;
      }
      var full = { name:d.name, kana:d.kana, tel:d.tel, zip:d.zip, addr:addrRest, company:d.company, subject:d.subject }[k] || '';
      var parts = { name:nm, kana:kn, tel:telp, zip:zipp }[k] || [full];
      var LBL = { name:'氏名', kana:'ふりがな', tel:'電話', zip:'郵便番号', addr:'住所', company:'会社名', subject:'件名' }[k];
      if (!full) { list.forEach(function(it){ if (it.req) add('L', it.el, LBL+'（設定タブに未入力）'); }); return; }
      var plan = splitFill(list, full, parts);
      if (k==='kana' && plan) { var ms = plan.map(function(p){ return kanaMode(p[0]); }); kanaGroupMode = ms.indexOf('kata')>=0 ? 'kata' : ms.indexOf('hira')>=0 ? 'hira' : ''; }
      if (!plan) { list.forEach(function(it){ if (it.req) add('L', it.el, LBL+'（欄の分かれ方が想定外）：'+it.lab.slice(0,16)); }); return; }
      plan.forEach(function(p){
        var it = p[0], v = p[1];
        if (k==='kana') v = kanaFor(it, v);
        var vv = trim(it.el, v); if (vv===null) { add('L', it.el, LBL+'（文字数制限）'); return; }
        setValue(it.el, vv);
        var tier = (k==='name' || k==='tel') && plan.length===1 ? 'H' : 'M';
        add(tier, it.el, LBL + (plan.length>1 ? '（分割）' : ''), vv);
      });
    });

    /* ---- 選択欄（セレクト・ラジオ）：「取材」の選択肢がある時だけ選ぶ。それ以外は人が選ぶ ---- */
    [].slice.call(scope.querySelectorAll('select')).forEach(function(sel){
      if (!visible(sel)) return;
      var lab = labelOf(sel);
      if (PATIENT.test(lab)) { res.skip.push({ el:sel, label:'患者向けの選択：'+lab.slice(0,20) }); return; }
      if (sel === prefSel || /都道府県|pref/i.test(lab)) {
        if (sel.selectedIndex > 0 && sel.value) return;
        var po = PREF && [].slice.call(sel.options).filter(function(o){ return o.value && o.textContent.trim().replace(/\s/g,'') === PREF; })[0];
        if (!po && PREF) po = [].slice.call(sel.options).filter(function(o){ return o.value && o.textContent.indexOf(PREF.replace(/[都府県]$/, '')) === 0; })[0];
        if (po) { sel.value = po.value; fire(sel, 'change'); add('M', sel, '都道府県', po.textContent.trim()); }
        else if (req(sel,lab)) add('L', sel, PREF ? '都道府県を選んでください' : '都道府県（設定タブの住所に都道府県から入れると自動で選びます）');
        return;
      }
      if (sel.selectedIndex > 0) return;
      var hit = [].slice.call(sel.options).filter(function(o){ return o.value && /取材|メディア|掲載/.test(o.textContent); })[0];
      if (hit) { sel.value = hit.value; fire(sel, 'change'); add('M', sel, '用件：「'+hit.textContent.trim().slice(0,16)+'」を選択'); }
      else if (req(sel,lab) || /用件|種別|項目|内容/.test(lab)) add('L', sel, '選択してください：'+lab.slice(0,24));
    });
    var radios = {};
    [].slice.call(scope.querySelectorAll('input[type=radio],input[type=checkbox]')).forEach(function(el){
      if (!visible(el) && !(el.parentElement && el.parentElement.offsetParent)) return;
      var key = el.type+':'+(el.name||el.id);
      (radios[key] = radios[key] || []).push(el);
    });
    Object.keys(radios).forEach(function(key){
      var g = radios[key], lab0 = labelOf(g[0]), box = g[0].closest('label,li,td,dd,div') || g[0].parentElement;
      if (g.some(function(e){ return e.checked; })) return;
      if (g[0].type==='checkbox' && g.length===1 && AGREE.test(lab0)) { g[0].click(); add('H', box, '同意チェック'); return; }
      if (PATIENT.test(lab0)) { res.skip.push({ el:box, label:'患者向けの選択：'+lab0.slice(0,20) }); return; }
      if (g[0].type==='checkbox' && g.length===1 && /確認/.test(lab0)) { g[0].click(); add('M', box, '確認チェック：'+lab0.slice(0,20)); return; }
      var hit = g.filter(function(e){ return /取材|メディア|掲載/.test(labelOf(e)); })[0];
      if (hit) { hit.click(); add('M', hit.closest('label,li,td,dd,div') || hit.parentElement, '用件：「'+labelOf(hit).slice(0,16)+'」を選択'); return; }
      if (g.some(function(e){ return req(e, labelOf(e)); }) || /用件|種別|項目|お問い?合わ?せ/.test(lab0)) add('L', box, '選択してください：'+lab0.slice(0,24));
    });

    if (!res.H.length && !res.M.length && !res.L.length) {
      alert('このページには入力できる欄が見つかりませんでした。\n問い合わせフォームのページか確認してください（文面アプリ③の「送れなかった」で記録できます）。');
      return;
    }
    /* ---- 結果パネル（ページの右下。項目を押すとその欄へ飛ぶ） ---- */
    var old = document.getElementById('__mirabonPanel'); if (old) old.remove();
    var pn = document.createElement('div'); pn.id = '__mirabonPanel';
    pn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:360px;max-height:70vh;overflow:auto;background:#fff;color:#1f2933;border:1px solid #d5dbe1;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);font:13px/1.6 -apple-system,"Hiragino Sans",sans-serif;padding:14px 16px;text-align:left';
    /* innerHTMLは使わない（Googleフォーム等のTrusted Types制限で落ちるため） */
    function E(tag, css, txt){ var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; }
    var head = E('div','display:flex;align-items:center;gap:8px');
    head.appendChild(E('b','font-size:14px','診ラボン自動入力'));
    head.appendChild(E('span','color:#6b7280;font-size:12px;flex:1', String(d.clinic)));
    var x = E('button','border:0;background:none;font-size:18px;cursor:pointer;color:#6b7280','×'); x.onclick = function(){ pn.remove(); }; head.appendChild(x);
    pn.appendChild(head);
    pn.appendChild(res.L.length
      ? E('div','margin-top:8px;padding:8px 10px;background:#fff1f1;color:#b91c1c;border-radius:6px;font-weight:700','赤枠の '+res.L.length+' 欄を手で入力・選択してください')
      : E('div','margin-top:8px;padding:8px 10px;background:#e6f4f1;color:#0f766e;border-radius:6px;font-weight:700','手入力が必要な欄はありません'));
    [['L','手で入力・選択（赤）'],['M','入れたので確認（黄）'],['H','自動で入力（緑）'],['skip','触っていない']].forEach(function(sg){
      var list = res[sg[0]]; if (!list.length) return;
      var c = sg[0]==='skip' ? ['#6b7280','#f3f4f6'] : COL[sg[0]];
      pn.appendChild(E('div','margin-top:10px;font-weight:700;color:'+c[0], sg[1]+'（'+list.length+'）'));
      list.forEach(function(it){
        var row = E('div','cursor:pointer;margin:3px 0;padding:3px 8px;border-left:4px solid '+c[0]+';background:'+c[1]+';border-radius:3px', it.label);
        if (it.v) row.appendChild(E('span','color:#6b7280','：'+it.v.slice(0,18).replace(/\n/g,' ')+(it.v.length>18?'…':'')));
        row.setAttribute('data-t', sg[0]);
        row.onclick = function(){ if (it.el) { it.el.scrollIntoView({ behavior:'smooth', block:'center' }); try { it.el.focus({ preventScroll:true }); } catch(err) {} } };
        pn.appendChild(row);
      });
    });
    var foot = E('div','margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:12px;color:#374151','送信ボタンは押していません。黄色と赤を確認してから送信。');
    foot.appendChild(E('b','display:block','確認画面がある時は最後まで進み、完了画面を見てから文面アプリで「送信した」を押してください。'));
    pn.appendChild(foot);
    (document.body||document.documentElement).appendChild(pn);
    var first = (res.L[0] || res.M[0] || res.H[0] || {}).el; if (first) first.scrollIntoView({ behavior:'smooth', block:'center' });
  }
  getPayload(run);
})();
