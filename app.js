'use strict';
(() => {
  const VQ = window.VQ;
  const $ = id => document.getElementById(id);
  const synth = window.speechSynthesis;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const timers = new Set();
  let currentRun = null, heldUtterance = null, activeRecognition = null, audioContext = null;
  let wakeLock = null, wakeOwner = null, wakeRequest = 0, wakePending = null, wakeTimer = null;
  let wakeState = '未取得';
  let japaneseVoices = [], database = null, saveQueue = Promise.resolve(), booting = true;
  let importCandidate = null, backupCandidate = null, resumeAction = null;
  let state = emptyState();
  class Stopped extends Error { constructor() { super('停止しました'); this.name = 'Stopped'; } }
  class SessionEnd extends Error {}
  function emptyState() {
    return { format:'voice-quiz-backup/v1', decks:[], progress:{}, pending:[], history:[], explanations:[], settings:{...VQ.DEFAULT_SETTINGS}, builtinHashes:{}, resume:null };
  }
  function errorText(error) { return error && error.message ? error.message : String(error); }
  function log(message, level = '情報') {
    if (level === 'エラー' || level === '注意') $('notice').textContent = String(message);
  }
  // 音声処理は実機検証済みのテスト版v3から移植する。
  function later(callback, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      try { callback(); } catch (error) { log(`タイマー処理の例外：${errorText(error)}`, 'エラー'); }
    }, ms);
    timers.add(id);
    return id;
  }
  function clearTimer(id) { if (id != null) { window.clearTimeout(id); timers.delete(id); } }
  function check(ctx) {
    if (ctx.stopped || currentRun !== ctx) throw new Stopped();
    if (ctx.finishRequested && !ctx.summarizing) throw new SessionEnd();
    if (ctx.blocked) throw ctx.blocked;
  }
  function delay(ms, ctx) {
    check(ctx);
    return new Promise((resolve, reject) => {
      let id;
      const cancel = () => { clearTimer(id); ctx.cancelers.delete(cancel); reject(new Stopped()); };
      ctx.cancelers.add(cancel);
      id = later(() => { ctx.cancelers.delete(cancel); resolve(); }, Math.max(0, ms));
    });
  }

  function setWakeState(value) { wakeState = value; $('wake-status').textContent = value; }
  function releaseSentinel(sentinel) {
    try { Promise.resolve(sentinel.release()).catch(error => log(`消灯防止の解放に失敗：${errorText(error)}`, '注意')); }
    catch (error) { log(`消灯防止の解放に失敗：${errorText(error)}`, '注意'); }
  }
  function releaseWake(ctx) {
    if (ctx && wakeOwner !== ctx) return;
    wakeOwner = null; wakePending = null; wakeRequest++;
    clearTimer(wakeTimer); wakeTimer = null;
    if (wakeLock) { const sentinel = wakeLock; wakeLock = null; releaseSentinel(sentinel); }
    setWakeState(navigator.wakeLock ? '未取得（解放済み）' : '未対応');
  }
  function requestWake(ctx) {
    // この関数の呼び出しから要求までに待機を入れず、開始タップの操作権限を使う。
    if (!navigator.wakeLock) { setWakeState('未対応'); log('画面の消灯防止は未対応です', '注意'); return; }
    if (ctx.stopped || currentRun !== ctx) return;
    wakeOwner = ctx;
    if (wakeLock && !wakeLock.released) return;
    if (wakePending === ctx) return;
    const token = ++wakeRequest;
    wakePending = ctx;
    setWakeState('未取得（要求中）');
    const failed = error => {
      if (token !== wakeRequest) return;
      clearTimer(wakeTimer); wakeTimer = null; wakePending = null;
      setWakeState('失敗'); log(`消灯防止の取得に失敗：${errorText(error)}`, 'エラー');
    };
    try {
      const promise = navigator.wakeLock.request('screen');
      wakeTimer = later(() => { failed(new Error('5秒以内に応答がありませんでした')); wakeRequest++; }, 5000);
      Promise.resolve(promise).then(sentinel => {
        if (token !== wakeRequest || wakeOwner !== ctx || ctx.stopped || currentRun !== ctx) { releaseSentinel(sentinel); return; }
        clearTimer(wakeTimer); wakeTimer = null; wakePending = null;
        wakeLock = sentinel; setWakeState('取得済み'); log('画面の消灯防止を取得しました');
        sentinel.addEventListener('release', () => {
          if (wakeLock !== sentinel) return;
          wakeLock = null; setWakeState('未取得（OSが解放）'); log('OSが画面の消灯防止を解放しました', '注意');
        });
      }).catch(failed);
    } catch (error) { failed(error); }
  }
  function prepareAudio(ctx) {
    try {
      if (!AudioContextClass) { log('合図音のWeb Audioは未対応です', '注意'); return; }
      if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextClass();
      const promise = audioContext.resume();
      Promise.resolve(promise).then(() => {
        if (!ctx.stopped && currentRun === ctx) log(`合図音の準備：${audioContext.state === 'running' ? '動作中' : '再開待ち'}`);
      }).catch(error => log(`合図音の準備に失敗：${errorText(error)}`, 'エラー'));
    } catch (error) { log(`合図音を準備できません：${errorText(error)}`, 'エラー'); }
  }
  async function playCue(ctx) {
    check(ctx);
    if (!ctx.settings.cue) { log('合図音：オフ'); return; }
    if (!audioContext || audioContext.state !== 'running') { log('合図音を鳴らせません（音声処理が停止中または未対応）', '注意'); return; }
    let oscillator, gain;
    const cleanup = () => {
      try { if (oscillator) { oscillator.stop(); oscillator.disconnect(); } if (gain) gain.disconnect(); }
      catch (error) { log(`合図音の終了処理：${errorText(error)}`, '注意'); }
    };
    ctx.cancelers.add(cleanup);
    try {
      oscillator = audioContext.createOscillator(); gain = audioContext.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = 880;
      const now = audioContext.currentTime;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.13, now + 0.01);
      gain.gain.setValueAtTime(0.13, now + 0.12); gain.gain.linearRampToValueAtTime(0, now + 0.15);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(now); oscillator.stop(now + 0.15);
      log('合図音：880Hz・0.15秒'); await delay(170, ctx);
    } catch (error) { if (error instanceof Stopped) throw error; log(`合図音のエラー：${errorText(error)}`, 'エラー'); }
    finally { ctx.cancelers.delete(cleanup); cleanup(); }
  }

  function speak(text, ctx, record = null) {
    check(ctx);
    text = VQ.applyYomi(text, ctx.yomi || {});
    hideListening();
    return new Promise((resolve, reject) => {
      if (!synth || !window.SpeechSynthesisUtterance) { reject(new Error('読み上げは未対応です')); return; }
      let utterance, timer, finished = false;
      const started = performance.now();
      const speech = { text, voice:ctx.settings.voiceName, rate:ctx.settings.rate, at:new Date().toISOString(), end:null, elapsedMs:null };
      if (record) record.speeches.push(speech);
      const finish = (error, end) => {
        if (finished) return; finished = true;
        clearTimer(timer); ctx.cancelers.delete(cancel);
        if (ctx.failSpeech === failSpeech) ctx.failSpeech = null;
        if (utterance) utterance.onend = utterance.onerror = null;
        if (heldUtterance === utterance) heldUtterance = null;
        speech.elapsedMs = Math.round(performance.now() - started); speech.end = end;
        if (error) { speech.error = errorText(error); reject(error); }
        else { ctx.lastSpeechEnd = performance.now(); ctx.lastSpeechEndType = end; log(`読み上げ終了：${end}（${speech.elapsedMs}ms）`); resolve(speech); }
      };
      const failSpeech = error => { finish(error, '認識の許可エラー'); try { synth.cancel(); } catch (_) {} };
      ctx.failSpeech = failSpeech;
      const cancel = () => finish(new Stopped(), '中断');
      ctx.cancelers.add(cancel);
      try {
        synth.cancel();
        utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP'; utterance.rate = ctx.settings.rate;
        if (ctx.settings.voice) utterance.voice = ctx.settings.voice;
        heldUtterance = utterance;
        utterance.onend = () => finish(null, '終了イベント');
        utterance.onerror = event => finish(new Error(`読み上げエラー：${event.error || '原因不明'}`), 'エラー');
        const timeout = Array.from(text).length * (250 / ctx.settings.rate) + 2000;
        timer = later(() => {
          // 保険タイマーでは成功扱いにせず、重なる発話を防ぐため読み上げも止める。
          finish(null, '保険タイマー（実際の終了は未確認）');
          try { synth.cancel(); } catch (error) { log(`読み上げ停止に失敗：${errorText(error)}`, 'エラー'); }
        }, timeout);
        log(`読み上げ開始：${text}`);
        synth.speak(utterance);
      } catch (error) { finish(error, '例外'); }
    });
  }

  const recognitionErrors = {
    'not-allowed':'マイクの許可が必要です。Safariのこのサイトのマイク設定を確認してください。',
    'service-not-allowed':'設定 → プライバシーとセキュリティ → 音声認識 → Safari をオンにしてください。',
    'no-speech':'聞き取れませんでした。',
    'audio-capture':'マイクが使えません。接続先や他のアプリの使用状況を確認してください。',
    'network':'通信エラーです。音声認識サービスへの接続を確認してください。',
    'aborted':'音声認識が中断されました。',
    'language-not-supported':'日本語の音声認識が利用できません。',
    'unsupported':'このブラウザーは音声認識に対応していません。',
    'start-failed':'音声認識を開始できませんでした。'
  };
  function recognitionError(code, detail = '') {
    const error = new Error(`${recognitionErrors[code] || '音声認識でエラーが発生しました。'}${detail ? `（${detail}）` : ''}`);
    error.code = code; return error;
  }
  async function beforeListening(ctx) {
    check(ctx);
    await speak('どうぞ。', ctx, ctx.record);
    const elapsed = performance.now() - (ctx.lastSpeechEnd || performance.now());
    await delay(Math.max(0, 300 - elapsed), ctx);
    await playCue(ctx);
    check(ctx);
  }
  function denied(error) { return error && ['service-not-allowed','not-allowed'].includes(error.code); }
  // 認識の寿命と回答受付区間を分離する。start()まで待機を挟まない。

  function createSession(ctx, events = []) {
    const engine = { events, error:null, receiver:null, session:0, restarts:0, closed:false, metrics:[] };
    let rec = null, restartTimer = null, startTimer = null;
    const stamp = (name, code = '') => {
      const entry = { at:new Date().toISOString(), name, code, session:engine.session };
      events.push(entry); log(`認識${entry.session} ${name}${code ? `［${code}］` : ''}：${entry.at}`);
    };
    const fail = error => {
      engine.error = error;
      if (denied(error)) {
        ctx.blocked = error; ctx.permissionFailed = true;
        $('recognition-help').hidden = false;
        if (ctx.failSpeech) ctx.failSpeech(error);
      }
      if (engine.receiver) engine.receiver.fail(error);
    };
    engine.close = () => {
      if (engine.closed) return;
      engine.closed = true; clearTimer(restartTimer); clearTimer(startTimer);
      ctx.cancelers.delete(cancel);
      if (rec) {
        // 終了イベントだけを記録し、再開を止める。
        try { rec.stop(); } catch (error) { stamp('stop失敗', error.name || 'exception'); }
        try { rec.abort(); } catch (error) { log(errorText(error), '注意'); }
        if (activeRecognition === rec) activeRecognition = null;
      }
    };
    const cancel = () => { if (engine.receiver) engine.receiver.fail(new Stopped()); engine.close(); };
    ctx.cancelers.add(cancel);
    const start = () => {
      if (engine.closed || ctx.stopped || currentRun !== ctx || engine.error) return;
      engine.session++;
      if (engine.session > 1) engine.restarts++;
      const session = engine.session;
      const requested = performance.now();
      let started = null;
      const metric = { session, requestedMs:requested, requestToStartMs:null, speechEndToStartMs:null, startToResultMs:null, speechEndType:ctx.lastSpeechEndType || '未取得', resultEvents:[] };
      engine.metrics.push(metric);
      const ignored = new Set(), owners = new Map();
      try {
        if (!Recognition) throw recognitionError('unsupported');
        rec = new Recognition(); const own = rec; activeRecognition = own;
        own.lang = 'ja-JP'; own.continuous = true; own.interimResults = true; own.maxAlternatives = 3;
        own.onstart = () => {
          started = performance.now(); metric.requestToStartMs = Math.round(started - requested);
          metric.speechEndToStartMs = ctx.lastSpeechEnd == null ? null : Math.round(started - ctx.lastSpeechEnd);
          stamp('onstart'); clearTimer(startTimer);
        };
        own.onresult = event => {
          if (engine.closed || ctx.stopped || currentRun !== ctx) return;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            // 読み上げ中の結果と前の回答の更新を捨てる。
            if (!engine.receiver) { ignored.add(i); continue; }
            if (ignored.has(i)) continue;
            if (owners.has(i) && owners.get(i) !== engine.receiver) continue;
            owners.set(i, engine.receiver);
            const now = performance.now();
            const resultDelay = started === null ? null : Math.round(now - started);
            if (metric.startToResultMs === null) metric.startToResultMs = resultDelay;
            metric.resultEvents.push({ sinceStartMs:resultDelay, sinceRequestMs:Math.round(now - requested), chars:Array.from(event.results[i][0]?.transcript || '').length });
            engine.receiver.metric(metric);
            const result = event.results[i];
            engine.receiver.result({ session, index:i, final:!!result.isFinal,
              candidates:Array.from(result, item => ({ text:item.transcript || '', confidence:Number.isFinite(item.confidence) ? item.confidence : null })) });
          }
        };
        own.onerror = event => {
          if (event.error !== 'no-speech') hideListening();
          stamp('onerror', event.error || 'unknown');
          if (engine.closed || ctx.stopped) return;
          const error = recognitionError(event.error || 'unknown');
          if (engine.receiver) engine.receiver.noteError(error);
          if (error.code !== 'no-speech') { fail(error); engine.close(); }
        };
        own.onend = () => {
          stamp('onend'); clearTimer(startTimer);
          if (activeRecognition === own) activeRecognition = null;
          if (!engine.closed && !ctx.stopped && currentRun === ctx && !engine.error) {
            stamp('再開予定'); restartTimer = later(start, 250);
          }
        };
        stamp(engine.session === 1 ? 'start要求' : '再開start要求');
        // 開始イベントが来ない場合の保険タイマー。
        startTimer = later(() => { stamp('開始応答タイムアウト', 'start-failed'); fail(recognitionError('start-failed')); engine.close(); }, 8000);
        own.start();
      } catch (error) {
        if (!error.code) error = recognitionError(error.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed', errorText(error));
        stamp('start例外', error.code); fail(error); engine.close();
      }
    };
    engine.start = start;
    return engine;
  }
  function recognize(ctx, record, isLong = false, parser = null, seconds = ctx.settings.answerTime) {
    check(ctx);
    const attempt = { at:new Date().toISOString(), long:isLong, text:'', candidates:[], segments:[], metrics:[], errors:[], restarts:0, elapsedMs:0, end:null };
    record.attempts.push(attempt);
    const engine = ctx.engine || createSession(ctx, record.events);
    const ownSession = !ctx.engine;
    return new Promise((resolve, reject) => {
      const began = performance.now(), restarts = engine.restarts;
      let done = false, initialTimer, silenceTimer, deadlineTimer, tickTimer;
      const noteError = error => attempt.errors.push({ code:error.code || 'exception', message:errorText(error), at:new Date().toISOString() });
      const update = () => {
        attempt.elapsedMs = Math.round(performance.now() - began); attempt.restarts = engine.restarts - restarts;
        const remaining = Math.max(0, (isLong ? 90 : seconds) - Math.floor(attempt.elapsedMs / 1000));
        $('listening-countdown').textContent = isLong ? `最大90秒まで あと${remaining}秒` : `残り${remaining}秒`;
        $('listening-transcript').textContent = attempt.text || '話してください';

      };
      const finish = (error, end) => {
        if (done) return; done = true;
        hideListening();
        [initialTimer,silenceTimer,deadlineTimer,tickTimer].forEach(clearTimer);
        ctx.cancelers.delete(cancel); engine.receiver = null;
        if (ownSession) engine.close();
        update(); attempt.end = end;
        if (error && !(error instanceof Stopped)) noteError(error);
          if (error) reject(error); else resolve(attempt);
      };
      const cancel = () => finish(new Stopped(), '中断'); ctx.cancelers.add(cancel);
      engine.receiver = {
        fail:error => finish(error, '認識エラー'), noteError,
        metric:item => { if (!attempt.metrics.includes(item)) attempt.metrics.push(item); },
        result:segment => {
          if (done) return;
          const index = attempt.segments.findIndex(item => item.session === segment.session && item.index === segment.index);
          if (index < 0) attempt.segments.push(segment); else attempt.segments[index] = segment;
          attempt.text = attempt.segments.map(item => item.candidates[0]?.text || '').join('');
          attempt.candidates = attempt.segments.flatMap(item => item.candidates);
          update(); log(`認識結果：${attempt.text || '文字なし'}`);
          if (!attempt.candidates.some(item => item.text.trim())) return;
          clearTimer(initialTimer);
          clearTimer(silenceTimer);
          if (isLong || !parser || selectCandidate(attempt, parser)) {
            silenceTimer = later(() => finish(null, isLong ? '最後の結果から3秒経過' : '最後の結果から1.5秒経過'), isLong ? 3000 : 1500);
          }
        }
      };
      $('run-status').textContent = `${ctx.answered + 1}問目／${ctx.settings.questionLimit}問`;
      initialTimer = later(() => finish(recognitionError('no-speech'), `最初の声が${seconds}秒以内に届きませんでした`), seconds * 1000);
      deadlineTimer = later(() => finish(attempt.text.trim() ? null : recognitionError('no-speech'), isLong ? '最大90秒' : '回答の制限時間'), isLong ? 90000 : (seconds + 15) * 1000);
      $('listening-overlay').hidden = document.visibilityState === 'hidden';
      $('listening-hint').hidden = !isLong;
      $('listening-title').textContent = '聞いています';
      const tick = () => { if (!done) { update(); tickTimer = later(tick, isLong ? 250 : 1000); } }; tick();
      if (engine.error) finish(engine.error, '開始失敗');
      else if (ownSession) engine.start();
    });
  }

  function hideListening() {
    $('listening-overlay').hidden = true;
    $('listening-title').textContent = '';
  }


  function selectCandidate(attempt, parser) {
    for (const candidate of attempt.candidates) {
      const parsed = parser(candidate.text);
      if (parsed) return { ...parsed, matched:candidate.text, confidence:candidate.confidence };
    }
    return null;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function on(node, event, callback) {
    node.addEventListener(event, eventObject => {
      try { Promise.resolve(callback(eventObject)).catch(reportError); } catch (error) { reportError(error); }
    });
  }
  function reportError(error) {
    if (currentRun) interruptRun();
    log(errorText(error), 'エラー');
  }
  function saveFailed() {
    database = null;
    $('save-warning').hidden = false;
    $('save-warning').textContent = '保存できません。このページを閉じると今回の変更が失われます。バックアップを書き出してください。';
  }
  async function openStorage() {
    try {
      database = await new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('保存は未対応です')); return; }
        const request = indexedDB.open('voice-quiz', 1);
        let finished = false;
        const timeout = window.setTimeout(() => { finished = true; reject(new Error('保存領域の応答がありません')); }, 5000);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state'); };
        request.onerror = () => { window.clearTimeout(timeout); reject(request.error); };
        request.onblocked = () => { window.clearTimeout(timeout); finished = true; reject(new Error('保存領域が別の画面で使われています')); };
        request.onsuccess = () => { window.clearTimeout(timeout); if (finished) request.result.close(); else resolve(request.result); };
      });
      database.onversionchange = () => { database.close(); saveFailed(); };
      const stored = await new Promise((resolve, reject) => {
        const transaction = database.transaction('state', 'readonly');
        const request = transaction.objectStore('state').get('main');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });
      if (stored) state = validateBackup(stored);
    } catch (_) { saveFailed(); }
  }
  function persist() {
    // 呼び出し時点を複製し、保存を直列にして古い状態での上書きを防ぐ。
    const snapshot = JSON.parse(JSON.stringify(state));
    saveQueue = saveQueue.then(() => {
      if (!database) return;
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('state', 'readwrite');
        transaction.objectStore('state').put(snapshot, 'main');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }).catch(() => saveFailed());
    return saveQueue;
  }
  function mergeDeck(incoming, policy, builtin = false) {
    const existing = new Map(state.decks.flatMap(deck => deck.cards.map(card => [card.id, card])));
    const accepted = incoming.cards.filter(card => policy === 'overwrite' || !existing.has(card.id));
    const acceptedIds = new Set(accepted.map(card => card.id));
    const sameDeck = state.decks.find(deck => deck.deck.id === incoming.deck.id);
    // 同じIDのカードを移す場合も、進み具合・説明記録はIDで保持する。
    state.decks = state.decks.map(deck => ({...deck, cards:deck.cards.filter(card => !acceptedIds.has(card.id))}));
    const remaining = state.decks.find(deck => deck.deck.id === incoming.deck.id);
    const replacement = {...incoming, builtin, cards:[...(remaining ? remaining.cards : []), ...accepted]};
    if (sameDeck) state.decks = state.decks.map(deck => deck.deck.id === incoming.deck.id ? replacement : deck);
    else state.decks.push(replacement);
    return accepted.length;
  }
  async function loadBuiltinDecks() {
    try {
      const response = await fetch('decks/index.json', {cache:'no-cache'});
      if (!response.ok) throw new Error('内蔵デッキの一覧を取得できません');
      const names = await response.json();
      if (!Array.isArray(names)) throw new Error('内蔵デッキの一覧の形式が違います');
      let loaded = 0;
      for (const name of names) {
        // 同一サイトのdecks内だけを取得する。
        if (typeof name !== 'string' || !/^[a-z0-9-]+\.json$/.test(name)) continue;
        try {
          const result = await fetch(`decks/${name}`, {cache:'no-cache'});
          if (!result.ok) throw new Error('問題集はまだ配置されていません');
          const raw = await result.json(), validated = VQ.validateDeck(raw);
          if (!validated.deck || !validated.validCount) throw new Error(validated.errors.join('。'));
          const digest = JSON.stringify(validated.deck);
          if (state.builtinHashes[name] !== digest) {
            mergeDeck(validated.deck, 'overwrite', true);
            state.builtinHashes[name] = digest;
            await persist();
          }
          loaded++;
          if (validated.errors.length) log(`内蔵デッキの一部を除外しました：${validated.errors.join('。')}`, '注意');
        } catch (_) { /* 取得できないデッキは保存済みの内容をそのまま使う。 */ }
      }
      $('deck-status').textContent = loaded ? '内蔵デッキを確認しました。' : '内蔵デッキを取得できませんでした。保存済みのデッキを使えます。';
    } catch (_) { $('deck-status').textContent = '内蔵デッキを取得できませんでした。保存済みのデッキを使えます。'; }
  }
  function findCard(id) {
    for (const deck of state.decks) { const card = deck.cards.find(item => item.id === id); if (card) return {card, deck}; }
    return null;
  }
  function learnedToday(today) {
    return Object.entries(state.progress).filter(([key, value]) => key.startsWith('_card:') && value.screenedAt === today).length;
  }
  function planned(weakOnly = false) {
    const today = VQ.localDate();
    return VQ.buildSession(state.decks, state.progress, {today, questionLimit:state.settings.questionLimit, newLimit:state.settings.newLimit, learnedToday:learnedToday(today), weakOnly});
  }
  function showPage(page) {
    if (currentRun && page !== 'drive') return;
    for (const name of ['home','drive','results','weak','import','settings','backup']) $('page-' + name).hidden = name !== page;
    if (page === 'home') renderHome();
    if (page === 'results') renderResults();
    if (page === 'weak') renderWeak();
    window.scrollTo(0, 0);
  }
  function renderHome() {
    const today = VQ.localDate(), items = VQ.buildSession(state.decks, state.progress, {today, questionLimit:100000, newLimit:state.settings.newLimit, learnedToday:learnedToday(today)});
    $('due-count').textContent = items.filter(item => !item.new).length;
    $('new-count').textContent = items.filter(item => item.new).length;
    $('start').disabled = booting || !items.length || !!currentRun;
    $('resume-panel').hidden = !state.resume;
    $('resume').disabled = booting || !!currentRun;
    $('finish-resume').disabled = booting || !!currentRun;
    $('resume-progress').textContent = state.resume ? `${state.resume.answered}問目まで進んでいます` : '';
    $('deck-list').replaceChildren();
    for (const deck of state.decks) $('deck-list').append(element('li', `${deck.deck.title}：${deck.cards.length}枚${deck.builtin ? '（内蔵デッキ）' : ''}`));
    if (!state.decks.some(deck => deck.cards.length)) $('deck-list').append(element('li', '問題集がありません。「取り込み」からJSONを追加できます。'));
  }
  function renderResults() {
    const latest = state.history[0];
    $('result-summary').textContent = latest ? `${latest.total}問中${latest.correct}問正解${latest.reason ? '。' + latest.reason : ''}` : 'まだ結果はありません。';
    $('missed-list').replaceChildren();
    for (const missed of latest ? latest.missed : []) $('missed-list').append(element('li', `${missed.term}：${missed.text}`));
    if (!latest || !latest.missed.length) $('missed-list').append(element('li', '言えなかった要点はありません。'));
    $('pending-list').replaceChildren();
    for (const pending of state.pending) $('pending-list').append(element('li', `${pending.term}（${modeLabel(pending.mode)}、${pending.date}）${pending.prompt ? '：' + pending.prompt : ''}`));
    if (!state.pending.length) $('pending-list').append(element('li', '保留の問題はありません。'));
    $('history-list').replaceChildren();
    for (const history of state.history.slice(0,30)) $('history-list').append(element('li', `${new Date(history.at).toLocaleString('ja-JP')}：${history.total}問中${history.correct}問正解${history.reason ? '。' + history.reason : ''}`));
  }
  function weakCards() {
    const counts = new Map();
    for (const [key, value] of Object.entries(state.progress)) if (!key.startsWith('_card:') && value.wrong) counts.set(value.cardId, (counts.get(value.cardId) || 0) + value.wrong);
    return [...counts].sort((a,b) => b[1] - a[1]);
  }
  function renderWeak() {
    $('weak-list').replaceChildren();
    for (const [id, count] of weakCards()) { const found = findCard(id); if (found) $('weak-list').append(element('li', `${found.card.term}：不正解${count}回`)); }
    if (!weakCards().length) $('weak-list').append(element('li', 'まだ苦手なカードはありません。'));
    $('start-weak').disabled = booting || !planned(true).length;
  }
  function modeLabel(mode) { return ({screen:'ふるい分け',flash:'単語帳',reverse:'逆引き',choice:'4択',tf:'○×',number:'数字',case:'ケース',explain:'説明'})[mode] || mode; }
  function voiceKey(voice) { return `${voice.voiceURI || voice.name}|${voice.lang}|${voice.name}`; }
  function refreshVoices() {
    try {
      japaneseVoices = synth ? synth.getVoices().filter(voice => /^ja/i.test(voice.lang)) : [];
      $('voice').replaceChildren();
      const auto = element('option', '日本語音声を自動選択（Kyoko優先）'); auto.value = ''; $('voice').append(auto);
      for (const voice of japaneseVoices) { const option = element('option', `${voice.name}（${voice.lang}）`); option.value = voiceKey(voice); $('voice').append(option); }
      $('voice').value = japaneseVoices.some(voice => voiceKey(voice) === state.settings.voice) ? state.settings.voice : '';
    } catch (_) { log('日本語音声を取得できませんでした。標準音声を使います。', '注意'); }
  }
  function renderSettings() {
    const settings = state.settings;
    $('rate').value = settings.rate; $('rate-value').textContent = settings.rate.toFixed(2);
    for (const [id,key] of [['answer-time','answerTime'],['question-limit','questionLimit'],['session-minutes','minutes'],['new-limit','newLimit']]) $(id).value = settings[key];
    $('explain-initially').checked = settings.explainInitially; $('cue').checked = settings.cue;
    refreshVoices();
  }
  function saveSettings() {
    state.settings = VQ.sanitizeSettings({voice:$('voice').value, rate:Number($('rate').value), answerTime:Number($('answer-time').value), questionLimit:Number($('question-limit').value), minutes:Number($('session-minutes').value), newLimit:Number($('new-limit').value), explainInitially:$('explain-initially').checked, cue:$('cue').checked});
    $('rate-value').textContent = state.settings.rate.toFixed(2);
    persist(); renderHome();
  }
  function runSettings(settings = state.settings) {
    const voice = japaneseVoices.find(item => voiceKey(item) === settings.voice) || japaneseVoices.find(item => /kyoko/i.test(item.name)) || null;
    return {...settings, voice, voiceName:voice ? voice.name : '標準の日本語音声'};
  }
  function makeContext(sample = false, settings = state.settings) {
    return { stopped:false, cancelers:new Set(), settings:runSettings(settings), settingsSnapshot:{...settings}, lastSpeechEnd:null, record:null, events:[], engine:null, blocked:null, yomi:{}, answered:0, correct:0, missed:[], pending:[], retried:new Set(), reviews:[], retries:[], fresh:[], tail:[], currentItem:null, sample, started:Date.now(), pausedMs:0, segmentStarted:performance.now(), remainingMs:settings.minutes * 60000, deadline:null, finishRequested:false, recorded:false };
  }
  function remainingTime(ctx) {
    return Math.max(0, ctx.remainingMs - (performance.now() - ctx.segmentStarted));
  }
  function saveContinuation(ctx) {
    state.resume = VQ.buildResume(ctx, {remainingMs:remainingTime(ctx), interruptedAt:Date.now()});
    return persist();
  }
  function saveJudgment(ctx) {
    // 判定とキュー更新は同期で確定させ、保存待ちの間に中断しても二重に出題しない。
    ctx.currentItem = null;
    if (ctx.explanation) { state.explanations.push(ctx.explanation); ctx.explanation = null; }
    return saveContinuation(ctx);
  }
  function armDeadline(ctx) {
    clearTimer(ctx.deadline);
    ctx.deadline = later(() => {
      ctx.finishRequested = true;
      cancelOperations(ctx);
    }, remainingTime(ctx));
  }
  function cancelOperations(ctx) {
    hideListening();
    for (const cancel of [...ctx.cancelers]) { try { cancel(); } catch (_) {} }
    ctx.cancelers.clear();
    if (ctx.engine) ctx.engine.close();
    try { if (synth) synth.cancel(); } catch (_) {}
    heldUtterance = null;
    try { if (activeRecognition) activeRecognition.abort(); } catch (_) {}
    activeRecognition = null;
  }
  function cleanup(ctx) {
    hideListening(); clearTimer(ctx.deadline); cancelOperations(ctx);
    releaseWake(ctx);
    if (audioContext && audioContext.state !== 'closed') { try { Promise.resolve(audioContext.suspend()).catch(() => {}); } catch (_) {} }
    if (currentRun === ctx) { currentRun = null; $('stop').hidden = true; }
  }
  function recordSession(ctx, reason) {
    if (ctx.recorded || ctx.sample) return;
    ctx.recorded = true;
    state.resume = null;
    state.history.unshift({at:new Date().toISOString(), total:ctx.answered, correct:ctx.correct, missed:ctx.missed, reason:reason || ''});
    state.history = state.history.slice(0,30);
    persist();
  }
  function stopAll(reason = '途中終了（停止ボタン）') {
    const ctx = currentRun;
    hideListening();
    if (!ctx) return;
    ctx.stopped = true;
    recordSession(ctx, reason);
    cleanup(ctx);
    showPage(ctx.sample ? 'settings' : 'results');
    $('notice').textContent = reason;
  }
  function interruptRun() {
    const ctx = currentRun;
    if (!ctx) return;
    // 結果を記録した後の読み上げ中は、中断データを再作成しない。
    ctx.stopped = true;
    if (!ctx.sample && !ctx.recorded) saveContinuation(ctx);
    cleanup(ctx);
    showPage('home');
    if (!ctx.sample && !ctx.recorded) $('notice').textContent = '学習を中断しました。停車中に「続きから再開」を押してください。';
  }
  function confirmResumeEnd(action) {
    if (!state.resume || booting || currentRun) return;
    resumeAction = action;
    $('resume-confirm-heading').textContent = action === 'finish' ? '中断した学習を終えますか' : '中断した学習を終えて新しく始めますか';
    const dialog = $('confirm-resume');
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    $('cancel-resume').focus();
  }
  function closeResumeDialog() {
    const dialog = $('confirm-resume');
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    resumeAction = null;
  }
  function endSavedSession() {
    if (!state.resume) return;
    recordSession({...VQ.sessionTotals(state.resume), sample:false, recorded:false}, '途中終了（中断のまま終了）');
  }
  function acceptResumeEnd() {
    const action = resumeAction;
    if (!action || currentRun || booting) return;
    closeResumeDialog();
    endSavedSession();
    if (action === 'finish') showPage('results');
    // 確認の「はい」もクリック同期のまま開始処理に渡す。
    else launch(action === 'weak');
  }
  function launch(weakOnly = false, sample = false, resume = false) {
    if (booting || currentRun) return;
    if (resume && !state.resume) return;
    if (!resume && !sample && state.resume) { confirmResumeEnd(weakOnly ? 'weak' : 'start'); return; }
    const items = sample || resume ? [] : planned(weakOnly);
    if (!sample && !resume && !items.length) { log('今出せる問題はありません。', '注意'); return; }
    if (!synth || !window.SpeechSynthesisUtterance || (!sample && !Recognition)) {
      log('このブラウザーでは音声機能を使えません。HTTPSのiPhone Safariで開いてください。', '注意'); return;
    }
    const saved = resume ? VQ.restoreSession(state.resume, state.decks) : null;
    const ctx = makeContext(sample, saved ? saved.settings : state.settings);
    if (saved) {
      const {settings, interruptedAt, ...restored} = saved;
      Object.assign(ctx, restored);
      ctx.pausedMs += Math.max(0, Date.now() - interruptedAt);
    } else {
      ctx.reviews = items.filter(item => !item.new); ctx.fresh = items.filter(item => item.new);
    }
    ctx.resuming = resume;
    currentRun = ctx;
    showPage('drive'); $('stop').hidden = false; $('recognition-help').hidden = true;
    $('run-status').textContent = '準備中';
    // ここから4つの開始要求まではawaitを入れず、クリックの権限を使う。
    if (!sample) { ctx.engine = createSession(ctx, ctx.events); ctx.engine.start(); }
    let unlocked;
    try { unlocked = speak('はい。', ctx).then(value => ({value}), error => ({error})); }
    catch (error) { unlocked = Promise.resolve({error}); }
    prepareAudio(ctx); requestWake(ctx);
    if (!sample) saveContinuation(ctx);
    void runFlow(ctx, unlocked).catch(reportError);
  }
  async function answer(ctx, prompt, parser, isLong, hint) {
    let failures = 0;
    await speak(prompt, ctx);
    for (;;) {
      check(ctx);
      await beforeListening(ctx);
      const record = {attempts:[], events:[], label:'回答'};
      const combined = text => VQ.parseCommand(text) || parser(text);
      let attempt = null;
      try { attempt = await recognize(ctx, record, isLong, combined); }
      catch (error) { if (error instanceof Stopped || error.code !== 'no-speech') throw error; }
      check(ctx);
      const command = attempt && selectCandidate(attempt, VQ.parseCommand);
      if (command) {
        if (command.value === 'skip') return {skip:true, text:attempt.text};
        if (command.value === 'repeat') await speak(prompt, ctx);
        else if (command.value === 'hint') { ctx.hint = true; await speak(hint || 'この問題にヒントはありません。', ctx); }
        else await speak('学習を続けます。', ctx);
        continue;
      }
      const parsed = attempt && (isLong ? (attempt.text.trim() ? {value:attempt.text, label:'説明'} : null) : selectCandidate(attempt, parser));
      if (parsed) return {...parsed, text:attempt.text};
      failures++;
      if (failures >= 2) return null;
      await speak('聞き取れませんでした。もう一度どうぞ。', ctx);
    }
  }
  function questionFor(card, item, deck) {
    const question = item.qIndex === undefined ? null : card.questions[item.qIndex];
    const points = item.mode === 'case' ? question.keypoints : card.keypoints;
    const textParser = text => text.trim() ? {value:text, label:text} : null;
    if (item.mode === 'screen') return {prompt:`新しい用語です。${card.term}。知ってる、少し、知らない、で答えてください。番号の、1、2、3、でも答えられます。`, parser:VQ.parseFamiliarity, answer:`${card.term}。${card.definition}`};
    if (item.mode === 'flash') return {prompt:`${card.term}。意味を思い浮かべてください。わかった、か、わからない、で答えてください。`, parser:VQ.parseFlash, answer:card.definition};
    if (item.mode === 'reverse') return {prompt:`${card.definition}。この用語は何ですか。`, parser:textParser, answer:card.term, hint:`${Array.from(VQ.applyYomi(card.term, deck.yomi || {}))[0]}で始まる言葉です。`};
    if (item.mode === 'choice') {
      const choices = VQ.makeChoices(card, state.decks.flatMap(group => group.cards));
      if (choices.length !== 4) return null;
      return {prompt:`${card.definition}。${choices.map((choice,index) => `${index + 1}番、${choice.term}。`).join('')}`, parser:VQ.parseChoice, answer:card.term, choices};
    }
    if (item.mode === 'tf') return {prompt:`${question.statement}。はい、か、いいえ、で答えてください。`, parser:VQ.parseBoolean, answer:question.answer ? 'はい' : 'いいえ', question};
    if (item.mode === 'number') return {prompt:question.question, parser:VQ.parseNumber, answer:`${question.answer}${question.unit || ''}`, question};
    return {prompt:item.mode === 'case' ? `${question.situation}。どう答えますか。` : `${card.term}を説明してください。`, parser:textParser, answer:points.map(point => typeof point === 'string' ? point : point.text).join('。'), hint:typeof points[0] === 'string' ? points[0] : points[0].text, points, question, isLong:true};
  }
  function notePending(ctx, item, card, question) {
    const pending = {key:item.key, cardId:card.id, term:card.term, mode:item.mode, date:VQ.localDate(), prompt:question.prompt};
    state.pending = state.pending.filter(value => value.key !== item.key); state.pending.push(pending); ctx.pending.push(pending);
  }
  async function explanationScore(ctx, card, question, response) {
    let score = VQ.gradeKeywords(response.text, question.points);
    if (score.needsSelfGrade) {
      const self = await answer(ctx, `要点は、${question.answer}。言えた、半分、言えなかった、で答えてください。`, VQ.parseSelfGrade, false, question.hint);
      if (!self) return null;
      score = VQ.selfGrade(self.skip ? 'none' : self.value, question.points);
    }
    check(ctx);
    ctx.explanation = {at:new Date().toISOString(), cardId:card.id, mode:question.question ? 'case' : 'explain', text:response.text, score};
    return score;
  }
  function scoreMessage(score) {
    if (score.selfReported) return `自己採点は、${score.perfect ? '言えた。完璧です。' : score.correct ? '半分です。どの要点が抜けたかは、画面で確認してください。' : '言えなかった、です。'}`;
    return `要点${score.total}つのうち${score.matched}つ言えました。${score.perfect ? '完璧です。' : `抜けていたのは、${score.missed.join('。')}。`}`;
  }
  function rememberMissed(ctx, card, score) {
    for (const text of score.missed) ctx.missed.push({term:card.term, text});
    for (const text of score.unconfirmed || []) ctx.missed.push({term:card.term, text:`要確認（自己採点は半分）：${text}`});
  }
  function enqueueRetry(ctx, key, tail = false) {
    if (ctx.retried.has(key)) return;
    const record = state.progress[key]; if (!record) return;
    ctx.retried.add(key);
    (tail ? ctx.tail : ctx.retries).push({key, cardId:record.cardId, mode:record.mode, ...(record.qIndex === undefined ? {} : {qIndex:record.qIndex}), retry:true});
  }
  async function askItem(ctx, item) {
    const found = findCard(item.cardId); if (!found) return false;
    const {card, deck} = found, question = questionFor(card, item, deck); if (!question) return false;
    ctx.yomi = deck.yomi || {}; ctx.hint = false;
    $('run-status').textContent = `${ctx.answered + 1}問目／${ctx.settings.questionLimit}問`;
    const response = await answer(ctx, question.prompt, question.parser, !!question.isLong, question.hint);
    check(ctx);
    if (!response) {
      notePending(ctx, item, card, question); ctx.answered++;
      await saveJudgment(ctx); check(ctx);
      await speak(`答えは、${question.answer}。聞き取りは保留にして、次へ進みます。`, ctx);
      return true;
    }
    const today = VQ.localDate();
    if (item.mode === 'screen') {
      const familiarity = response.skip ? 'unknown' : response.value;
      let score = null;
      if (familiarity === 'known') {
        const explain = questionFor(card, {mode:'explain'}, deck);
        const explanation = await answer(ctx, explain.prompt, explain.parser, true, explain.hint);
        check(ctx);
        if (!explanation) { notePending(ctx, item, card, explain); ctx.answered++; await saveJudgment(ctx); check(ctx); await speak(`答えは、${explain.answer}。聞き取りは保留にします。`, ctx); return true; }
        score = explanation.skip ? VQ.selfGrade('none', explain.points) : await explanationScore(ctx, card, explain, explanation);
        check(ctx);
        if (!score) { notePending(ctx, item, card, explain); ctx.answered++; await saveJudgment(ctx); check(ctx); await speak(`答えは、${explain.answer}。聞き取りは保留にします。`, ctx); return true; }
        rememberMissed(ctx, card, score);
      }
      const initial = VQ.initialProgress(card, familiarity, score && {...score, hint:ctx.hint}, ctx.settings, today);
      Object.assign(state.progress, initial.progress);
      for (const key of initial.retryKeys) enqueueRetry(ctx, key, true);
      if (response.skip) {
        const flash = state.progress[`${card.id}:flash`];
        if (flash) state.progress[flash.key] = VQ.reviewProgress(flash, {correct:false}, today);
      }
      const correct = !!score && score.correct;
      ctx.answered++; if (correct) ctx.correct++;
      await saveJudgment(ctx); check(ctx);
      if (score) await speak(scoreMessage(score), ctx);
      if (response.skip) await speak(`不正解。正しくは、${question.answer}。`, ctx);
      if (familiarity === 'known') await speak(correct ? '正解。' : `不正解。正しくは、${question.answer}。`, ctx);
      await speak(`${card.definition}${familiarity === 'unknown' && card.example ? '。例は、' + card.example : ''}`, ctx);
      return true;
    }
    let score = null, correct = false;
    if (!response.skip) {
      if (item.mode === 'flash') correct = response.value;
      else if (item.mode === 'reverse') correct = VQ.matchesTerm(response.text, card, deck.yomi || {});
      else if (item.mode === 'choice') correct = question.choices[response.value - 1].id === card.id;
      else if (item.mode === 'tf') correct = response.value === question.question.answer;
      else if (item.mode === 'number') correct = Math.abs(response.value - question.question.answer) <= (question.question.tolerance || 0) + Number.EPSILON * Math.max(1, Math.abs(question.question.answer)) * 4;
      else { score = await explanationScore(ctx, card, question, response); if (score) correct = score.correct; }
    } else if (question.isLong) score = VQ.selfGrade('none', question.points);
    check(ctx);
    if (question.isLong && !score) {
      notePending(ctx, item, card, question); ctx.answered++; await saveJudgment(ctx); check(ctx); await speak(`答えは、${question.answer}。聞き取りは保留にします。`, ctx); return true;
    }
    const updated = VQ.applyReview(card, state.progress, item, {correct, perfect:!!score && score.perfect, hint:ctx.hint}, today, ctx.settings);
    state.progress = updated.progress;
    // 成功した保留項目も自動では取り除かず、保留一覧として履歴を残す。
    for (const key of updated.retryKeys) enqueueRetry(ctx, key, correct && state.progress[key].stage === 0);
    ctx.answered++; if (correct) ctx.correct++;
    if (score) rememberMissed(ctx, card, score);
    await saveJudgment(ctx); check(ctx);
    if (score) await speak(scoreMessage(score), ctx);
    await speak(correct ? '正解。' : `不正解。正しくは、${question.answer}。`, ctx);
    await speak(question.question && question.question.explain ? question.question.explain : card.definition, ctx);
    return true;
  }
  async function runFlow(ctx, unlocked) {
    let reason = '';
    try {
      const result = await unlocked; check(ctx); if (result.error) throw result.error;
      if (ctx.sample) { await speak('この声と速さで読み上げます。声で答える復習アプリです。', ctx); return; }
      armDeadline(ctx);
      await speak(ctx.resuming ? '続きから再開します。' : `今日は復習${ctx.reviews.length}問、新しいカード${ctx.fresh.length}枚です。始めます。`, ctx);
      while (ctx.answered < ctx.settings.questionLimit) {
        check(ctx);
        // 段階0の単語帳を末尾で復習できるよう、残りの問題枠を確保する。
        const remaining = ctx.settings.questionLimit - ctx.answered;
        const item = ctx.reviews.shift() || ctx.retries.shift() || (ctx.tail.length >= remaining ? ctx.tail.shift() : ctx.fresh.shift() || ctx.tail.shift());
        if (!item) break;
        ctx.currentItem = item;
        await askItem(ctx, item); check(ctx);
        ctx.currentItem = null;
        if (ctx.answered < ctx.settings.questionLimit) await delay(1000, ctx);
      }
    } catch (error) {
      if (ctx.stopped) return;
      if (ctx.finishRequested) reason = '設定した時間になりました。';
      else {
        reason = denied(error) || ctx.permissionFailed ? '聞き取りが使えませんでした。画面の案内を確認してください。' : errorText(error);
        if (denied(error) || ctx.permissionFailed) $('recognition-help').hidden = false;
        ctx.blocked = null;
        if (ctx.engine) ctx.engine.close();
        try { await speak(reason, ctx); } catch (_) {}
        log(reason, 'エラー');
        if (currentRun === ctx) interruptRun();
      }
    } finally {
      if (!ctx.stopped && currentRun === ctx) {
        clearTimer(ctx.deadline);
        ctx.summarizing = true;
        if (!ctx.sample) {
          if (ctx.engine) ctx.engine.close();
          recordSession(ctx, reason);
          try { await speak(`今日は${ctx.answered}問中${ctx.correct}問正解でした。言えなかった要点は、画面の結果で確認できます。`, ctx); } catch (_) {}
        }
        if (currentRun === ctx) { cleanup(ctx); showPage(ctx.sample ? 'settings' : 'results'); }
      }
    }
  }

  function inspectImport() {
    importCandidate = null; $('add-import').disabled = true;
    $('import-errors').replaceChildren();
    try {
      const checked = VQ.validateDeck(JSON.parse($('import-text').value));
      const ids = new Set(state.decks.flatMap(deck => deck.cards.map(card => card.id)));
      const collisions = checked.deck ? checked.deck.cards.filter(card => ids.has(card.id)).length : 0;
      $('import-summary').textContent = `${checked.deck ? checked.deck.deck.title : 'デッキを確認できません'}。${checked.totalCount}枚中${checked.validCount}枚を取り込み可能。同じIDは${collisions}枚です。`;
      for (const error of checked.errors) $('import-errors').append(element('li', error));
      if (checked.deck && checked.validCount) { importCandidate = checked.deck; $('add-import').disabled = false; }
    } catch (_) { $('import-summary').textContent = 'JSONを読み取れませんでした。括弧や引用符を確認してください。'; }
  }
  function addImport() {
    if (!importCandidate) return;
    const count = mergeDeck(importCandidate, $('duplicate-policy').value);
    persist(); renderHome();
    $('import-summary').textContent = `${count}枚を取り込みました。学習履歴は保持しました。`;
    importCandidate = null; $('add-import').disabled = true;
  }
  function validateBackup(input) {
    const fail = () => { throw new Error('バックアップの形式が正しくありません。元のデータは変更していません。'); };
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const text = value => typeof value === 'string';
    const date = value => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && VQ.localDate(new Date(`${value}T12:00:00`)) === value;
    if (!object(input) || input.format !== 'voice-quiz-backup/v1' || !Array.isArray(input.decks) || !object(input.progress) || !Array.isArray(input.pending) || !Array.isArray(input.history) || !Array.isArray(input.explanations) || !object(input.settings)) fail();
    const result = emptyState(), cardIds = new Set(), deckIds = new Set(), allowed = new Map();
    for (const deck of input.decks) {
      const valid = VQ.validateDeck(deck);
      if (!valid.deck || valid.errors.length || deckIds.has(valid.deck.deck.id)) fail();
      deckIds.add(valid.deck.deck.id);
      for (const card of valid.deck.cards) {
        if (cardIds.has(card.id)) fail(); cardIds.add(card.id);
        for (const item of VQ.allItems(card)) allowed.set(item.key, item);
      }
      result.decks.push({...valid.deck, builtin:deck.builtin === true});
    }
    // 問題の更新で消えた項目の履歴も、キーの形式を検査して保持する。
    for (const [key, value] of Object.entries(input.progress)) {
      if (!object(value)) fail();
      if (key.startsWith('_card:')) {
        if (!/^_card:[a-z0-9-]+$/.test(key) || !count(value.recallStreak) || !date(value.screenedAt)) fail();
        result.progress[key] = {cardId:key.slice(6), recallStreak:value.recallStreak, screenedAt:value.screenedAt};
      } else {
        if (!/^[a-z0-9-]+:(flash|reverse|choice|explain|q\d+)$/.test(key) || !Number.isInteger(value.stage) || value.stage < 0 || value.stage > 6 || !date(value.due) || !count(value.correct) || !count(value.wrong) || !count(value.streak)) fail();
        const cardId = key.split(':')[0], mode = value.mode;
        if (value.cardId !== cardId || !['flash','reverse','choice','explain','tf','number','case'].includes(mode)) fail();
        if (key.includes(':q') && (!count(value.qIndex) || key !== `${cardId}:q${value.qIndex}` || !['tf','number','case'].includes(mode))) fail();
        if (!key.includes(':q') && key !== `${cardId}:${mode}`) fail();
        result.progress[key] = {...value, key, cardId};
      }
    }
    for (const pending of input.pending) {
      if (!object(pending) || !text(pending.key) || !text(pending.cardId) || !text(pending.term) || !text(pending.mode) || !date(pending.date) || (pending.prompt !== undefined && !text(pending.prompt))) fail();
      result.pending.push({key:pending.key, cardId:pending.cardId, term:pending.term, mode:pending.mode, date:pending.date, prompt:pending.prompt || ''});
    }
    for (const history of input.history.slice(0,30)) {
      if (!object(history) || !text(history.at) || !Number.isFinite(Date.parse(history.at)) || !count(history.total) || !count(history.correct) || history.correct > history.total || !Array.isArray(history.missed)) fail();
      for (const missed of history.missed) if (!object(missed) || !text(missed.term) || !text(missed.text)) fail();
      result.history.push({at:history.at, total:history.total, correct:history.correct, missed:history.missed.map(value => ({term:value.term,text:value.text})), reason:text(history.reason) ? history.reason : ''});
    }
    for (const record of input.explanations) {
      if (!object(record) || !text(record.at) || !Number.isFinite(Date.parse(record.at)) || !text(record.cardId) || !['case','explain'].includes(record.mode) || !text(record.text) || !object(record.score)) fail();
      const score = record.score;
      if (typeof score.correct !== 'boolean' || typeof score.perfect !== 'boolean' || !count(score.total) || !count(score.matched) || score.matched > score.total || !Array.isArray(score.missed) || !score.missed.every(text) || !Array.isArray(score.hits) || !score.hits.every(count)) fail();
      result.explanations.push({...record, score:{...score}});
    }
    result.settings = VQ.sanitizeSettings(input.settings);
    if (input.resume != null) result.resume = VQ.validateResume(input.resume);
    if (object(input.builtinHashes)) for (const [key,value] of Object.entries(input.builtinHashes)) if (/^[a-z0-9-]+\.json$/.test(key) && text(value)) result.builtinHashes[key] = value;
    return result;
  }
  function exportBackup() {
    $('backup-text').value = JSON.stringify(state, null, 2);
    $('backup-status').textContent = '全データを書き出しました。「コピー」で保存してください。';
  }
  function copyBackup() {
    const value = $('backup-text').value;
    const fallback = () => {
      $('backup-text').focus(); $('backup-text').select(); $('backup-text').setSelectionRange(0, value.length);
      $('backup-status').textContent = '自動コピーができませんでした。文字を選択しました。長押ししてコピーしてください。';
    };
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
      Promise.resolve(navigator.clipboard.writeText(value)).then(() => { $('backup-status').textContent = 'コピーしました。'; }).catch(fallback);
    } catch (_) { fallback(); }
  }
  function closeBackupDialog() {
    const dialog = $('confirm-backup');
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    backupCandidate = null;
  }
  function prepareBackup() {
    try {
      backupCandidate = validateBackup(JSON.parse($('backup-text').value));
      if ($('confirm-backup').showModal) $('confirm-backup').showModal(); else $('confirm-backup').setAttribute('open','');
      $('confirm-replace').focus();
    } catch (error) { backupCandidate = null; $('backup-status').textContent = error instanceof SyntaxError ? 'JSONを読み取れませんでした。元のデータは変更していません。' : errorText(error); }
  }
  async function replaceBackup() {
    if (!backupCandidate || currentRun) return;
    state = backupCandidate; closeBackupDialog();
    await persist(); renderSettings(); renderHome(); renderResults(); renderWeak();
    $('backup-status').textContent = 'バックアップを読み込み、全データを置き換えました。';
  }

  for (const button of document.querySelectorAll('[data-page]')) on(button, 'click', () => showPage(button.dataset.page));
  on($('start'), 'click', () => launch());
  on($('start-weak'), 'click', () => launch(true));
  on($('resume'), 'click', () => launch(false, false, true));
  on($('finish-resume'), 'click', () => confirmResumeEnd('finish'));
  on($('confirm-resume-end'), 'click', acceptResumeEnd);
  on($('cancel-resume'), 'click', closeResumeDialog);
  on($('confirm-resume'), 'cancel', () => { resumeAction = null; });
  on($('sample'), 'click', () => launch(false, true));
  on($('stop'), 'click', () => stopAll());
  for (const id of ['voice','rate','answer-time','question-limit','session-minutes','new-limit','explain-initially','cue']) on($(id), id === 'rate' ? 'input' : 'change', saveSettings);
  on($('inspect-import'), 'click', inspectImport);
  on($('import-text'), 'input', () => { importCandidate = null; $('add-import').disabled = true; });
  on($('add-import'), 'click', addImport);
  on($('export-backup'), 'click', exportBackup);
  on($('copy-backup'), 'click', copyBackup);
  on($('load-backup'), 'click', prepareBackup);
  on($('confirm-replace'), 'click', replaceBackup);
  on($('cancel-replace'), 'click', closeBackupDialog);
  on($('confirm-backup'), 'cancel', () => { backupCandidate = null; });
  on(window, 'pagehide', interruptRun);
  on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') interruptRun(); else refreshVoices(); });
  on(window, 'error', event => reportError(new Error(event.message || '画面の処理でエラーが発生しました。')));
  on(window, 'unhandledrejection', event => { reportError(event.reason); event.preventDefault(); });
  if (synth && synth.addEventListener) on(synth, 'voiceschanged', refreshVoices);
  async function initialize() {
    await openStorage(); renderSettings(); renderHome(); renderResults();
    await loadBuiltinDecks();
    booting = false; $('start').textContent = '運転モード開始'; renderHome(); renderWeak();
    setWakeState(navigator.wakeLock ? '未取得' : '未対応');
    // iPhoneでは音声一覧が遅れて届くため、初期化後も取得する。
    for (const wait of [250,750,1500,3000,5000,8000]) later(refreshVoices, wait);
  }
  void initialize().catch(error => { booting = false; $('start').textContent = '運転モード開始'; renderHome(); reportError(error); });
})();

