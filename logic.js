(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VQ = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({ voice:'', rate:0.9, answerTime:10, questionLimit:20, minutes:10, newLimit:10, explainInitially:false, cue:true });
  const INTERVALS = Object.freeze([1, 1, 3, 7, 14, 30, 60]);
  const RECALL_MODES = Object.freeze(['reverse', 'choice', 'tf', 'number']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const hasText = value => typeof value === 'string' && value.trim().length > 0;
  const idPattern = /^[a-z0-9-]+$/;

  // 用語とキーワードの照合は、かなと句読点の表記ゆれを吸収する。
  function normalize(text) {
    return String(text == null ? '' : text).normalize('NFKC').toLowerCase()
      .replace(/[\s\p{P}]/gu, '')
      .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
  }

  // 実機で確認済みの判定関数は、テスト版 v3 の正規化とともに保存する。
  const testedParsers = (function () {
    function normalize(text) { return String(text).normalize('NFKC').toLowerCase().replace(/[\s、。！？!?「」『』"'・]/g, ''); }
    function answerOnly(text) {
      return normalize(text).replace(/^(答えは|回答は|答え|回答)/, '').replace(/(だと思います|だと思う|でお願いします|お願いします|です|でした)$/, '');
    }
    function parseBoolean(text) {
      const value = answerOnly(text);
      if (['まる','マル','丸','○','◯','〇','正しい','ただしい','はい','正解','せいかい','そう'].includes(value)) return { value:true, label:'まる' };
      if (['ばつ','バツ','×','違う','ちがう','いいえ','間違い','ちがいます','違います','まちがい','間違ってる','まちがってる'].includes(value)) return { value:false, label:'ばつ' };
      return null;
    }
    function parseChoice(text) {
      const value = answerOnly(text);
      const forms = [
        ['1','一','いち','1番','一番','いちばん','1番目','一番目','いちばんめ','ひとつめ','ひとつ目','一つ目','1つ目','1つめ','最初'],
        ['2','二','に','2番','二番','にばん','2番目','二番目','にばんめ','ふたつめ','ふたつ目','二つ目','2つ目','2つめ'],
        ['3','三','さん','3番','三番','さんばん','3番目','三番目','さんばんめ','みっつめ','みっつ目','三つ目','3つ目','3つめ'],
        ['4','四','よん','し','4番','四番','よんばん','4番目','四番目','よんばんめ','よっつめ','よっつ目','四つ目','4つ目','4つめ']
      ];
      const index = forms.findIndex(items => items.includes(value));
      return index < 0 ? null : { value:index + 1, label:`${index + 1}番` };
    }
    function japaneseInteger(text) {
      const digits = { '〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
      const small = { '十':10,'百':100,'千':1000 };
      const large = { '万':10000,'億':100000000,'兆':1000000000000 };
      let total = 0, section = 0, buffer = '';
      for (const char of text) {
        if (/[0-9]/.test(char)) buffer += char;
        else if (Object.prototype.hasOwnProperty.call(digits, char)) buffer += String(digits[char]);
        else if (small[char]) { section += (buffer === '' ? 1 : Number(buffer)) * small[char]; buffer = ''; }
        else if (large[char]) { section += buffer === '' ? 0 : Number(buffer); total += (section || 1) * large[char]; section = 0; buffer = ''; }
        else return null;
      }
      const value = total + section + (buffer === '' ? 0 : Number(buffer));
      return Number.isSafeInteger(value) ? value : null;
    }
    function parseNumber(text) {
      const value = normalize(text).replace(/マイナス/g, '-').replace(/プラス/g, '+').replace(/てん|点/g, '.').replace(/(\d),(?=\d)/g, '$1');
      const match = value.match(/[+-]?[0-9〇零一二三四五六七八九十百千万億兆]+(?:\.[0-9〇零一二三四五六七八九]+)?/);
      if (!match) return null;
      const token = match[0], negative = token.startsWith('-');
      const [integerPart, fraction] = token.replace(/^[+-]/, '').split('.');
      const integer = japaneseInteger(integerPart);
      if (integer === null) return null;
      const digitMap = { '〇':'0','零':'0','一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9' };
      const fractionText = fraction ? [...fraction].map(char => digitMap[char] ?? char).join('') : '';
      const number = Number(`${negative ? '-' : ''}${integer}${fractionText ? '.' + fractionText : ''}`);
      return Number.isFinite(number) ? { value:number, label:String(number), token } : null;
    }
    return { parseBoolean, parseChoice, parseNumber };
  }());

  function answerOnly(text) {
    return normalize(text).replace(/^(答えは|回答は|答え|回答)/, '')
      .replace(/(だと思います|だと思う|でお願いします|お願いします|です|でした)$/, '');
  }
  const knownWords = ['知ってる','知っている','知ってます','知っています','わかった','わかる','わかります','はい'];
  const unknownWords = ['知らない','知りません','わからない','わかりません','いいえ'];
  function matchWords(text, groups) {
    const value = answerOnly(text);
    for (const [result, label, words] of groups) if (words.some(word => answerOnly(word) === value)) return { value:result, label };
    return null;
  }
  function parseFamiliarity(text) {
    return matchWords(text, [
      ['unknown', '知らない', unknownWords],
      ['vague', 'うろ覚え', ['うろ覚え','うろおぼえ','なんとなく','たぶん','少し']],
      ['known', '知ってる', knownWords]
    ]);
  }
  function parseFlash(text) { return matchWords(text, [[false, 'わからない', unknownWords], [true, 'わかった', knownWords]]); }
  function parseSelfGrade(text) {
    return matchWords(text, [['none', '言えなかった', ['言えなかった','いえなかった']], ['half', '半分', ['半分','はんぶん']], ['all', '言えた', ['言えた','いえた']]]);
  }
  function parseCommand(text) {
    return matchWords(text, [
      ['repeat', 'もう一回', ['もう一回','もう一度','もういっかい','もういちど']],
      ['hint', 'ヒント', ['ヒント']], ['skip', 'スキップ', ['スキップ']],
      ['pause', '一時停止', ['止めて','とめて','ストップ','一時停止','いちじていし']],
      ['resume', '再開', ['再開','さいかい','続けて','つづけて']],
      ['finish', '終了', ['終わり','おわり','終了','しゅうりょう']]
    ]);
  }

  function applyYomi(text, yomi) {
    const dictionary = isObject(yomi) ? yomi : {};
    const keys = Object.keys(dictionary).filter(key => key.length && typeof dictionary[key] === 'string').sort((a, b) => b.length - a.length);
    if (!keys.length) return String(text == null ? '' : text);
    // 一度に置換し、長いキーを優先する。置換後の読みを再置換しない。
    const escaped = keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return String(text == null ? '' : text).replace(new RegExp(escaped.join('|'), 'g'), key => dictionary[key]);
  }
  function matchesTerm(text, card, yomi) {
    const spoken = normalize(text);
    const terms = [card.term, ...(Array.isArray(card.aliases) ? card.aliases : []), applyYomi(card.term, yomi)];
    return terms.some(term => { const word = normalize(term); return word.length > 0 && spoken.includes(word); });
  }
  function makeChoices(card, allCards, random) {
    const nextRandom = typeof random === 'function' ? random : Math.random;
    const shuffle = values => {
      const result = values.slice();
      for (let index = result.length - 1; index > 0; index--) {
        const value = nextRandom(), other = Math.min(index, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * (index + 1))));
        [result[index], result[other]] = [result[other], result[index]];
      }
      return result;
    };
    const available = Array.isArray(allCards) ? allCards : [], selected = [card], terms = new Set([normalize(card.term)]);
    const confusing = new Set(card.confusables || []), tags = new Set(card.tags || []);
    const groups = [available.filter(other => confusing.has(other.id)), available.filter(other => (other.tags || []).some(tag => tags.has(tag))), available];
    for (const group of groups) {
      for (const other of shuffle(group)) {
        const term = normalize(other.term);
        if (selected.length >= 4) break;
        if (other.id !== card.id && term && !terms.has(term)) { selected.push(other); terms.add(term); }
      }
      if (selected.length >= 4) break;
    }
    return shuffle(selected);
  }
  function pointText(point) { return typeof point === 'string' ? point : point.text; }
  function scoreFromHits(points, hits, needsSelfGrade) {
    const total = points.length, hitSet = new Set(hits), matched = hits.length;
    return { correct:total > 0 && matched >= Math.ceil(total / 2), perfect:total > 0 && matched === total, hits, missed:points.filter((point, index) => !hitSet.has(index)).map(pointText), total, matched, needsSelfGrade:!!needsSelfGrade };
  }
  function gradeKeywords(text, keypoints) {
    const points = Array.isArray(keypoints) ? keypoints : [], spoken = normalize(text), hits = [];
    let needsSelfGrade = false;
    points.forEach((point, index) => {
      const keywords = isObject(point) && Array.isArray(point.keywords) ? [...new Set(point.keywords.map(normalize).filter(Boolean))] : [];
      if (!keywords.length) { needsSelfGrade = true; return; }
      const minimum = Number.isInteger(point.min) && point.min > 0 ? point.min : 1;
      if (keywords.filter(word => spoken.includes(word)).length >= minimum) hits.push(index);
    });
    return scoreFromHits(points, hits, needsSelfGrade);
  }
  function selfGrade(value, keypoints) {
    const points = Array.isArray(keypoints) ? keypoints : [];
    const count = value === 'all' ? points.length : value === 'half' ? Math.ceil(points.length / 2) : 0;
    const score = { ...scoreFromHits(points, points.map((point, index) => index).slice(0, count), false), perfect:value === 'all' && points.length > 0, selfReported:true, unconfirmed:[] };
    // 半分という申告から、言えた要点の位置までは特定しない。
    return value === 'half' ? { ...score, hits:[], missed:[], unconfirmed:points.map(pointText) } : score;
  }

  function localDate(date) {
    const value = date === undefined ? new Date() : date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) throw new TypeError('日付が正しくありません。');
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  function addDays(dateString, days) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (!match || !Number.isInteger(days)) throw new TypeError('日付または日数が正しくありません。');
    const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    if (localDate(value) !== dateString) throw new TypeError('日付が正しくありません。');
    value.setDate(value.getDate() + days);
    return localDate(value);
  }
  function sanitizeSettings(value) {
    const input = isObject(value) ? value : {};
    const result = { ...DEFAULT_SETTINGS };
    if (typeof input.voice === 'string') result.voice = input.voice;
    if (Number.isFinite(input.rate) && input.rate >= 0.7 && input.rate <= 1.5) result.rate = input.rate;
    for (const [key, allowed] of [['answerTime',[5,10,15]], ['questionLimit',[10,20,30]], ['minutes',[5,10,20]], ['newLimit',[5,10,20]]]) if (allowed.includes(input[key])) result[key] = input[key];
    for (const key of ['explainInitially','cue']) if (typeof input[key] === 'boolean') result[key] = input[key];
    return result;
  }

  function validateDeck(input) {
    const errors = [], cards = [], ids = new Set();
    const totalCount = isObject(input) && Array.isArray(input.cards) ? input.cards.length : 0;
    const failDeck = message => ({ deck:null, errors:[message], validCount:0, totalCount });
    if (!isObject(input)) return failDeck('デッキはJSONオブジェクトで指定してください。');
    if (input.format !== 'voice-quiz/v1') return failDeck('format は voice-quiz/v1 にしてください。');
    if (!isObject(input.deck) || typeof input.deck.id !== 'string' || !idPattern.test(input.deck.id) || !hasText(input.deck.title)) return failDeck('デッキの id（英小文字・数字・ハイフン）と title が必要です。');
    if (!Array.isArray(input.cards)) return failDeck('cards は配列で指定してください。');
    if (input.yomi !== undefined && (!isObject(input.yomi) || Object.entries(input.yomi).some(([key, value]) => !key || !hasText(value)))) return failDeck('yomi は空でない文字列同士の辞書にしてください。');
    for (const field of ['source','asof']) if (input.deck[field] !== undefined && typeof input.deck[field] !== 'string') return failDeck(`デッキの ${field} は文字列にしてください。`);
    function checkPoints(points, field, problems) {
      if (!Array.isArray(points) || !points.length) { problems.push(`${field} は1つ以上の要点の配列が必要です。`); return []; }
      return points.map((point, index) => {
        if (hasText(point)) return point.trim();
        if (!isObject(point) || !hasText(point.text)) { problems.push(`${field}[${index}] に text が必要です。`); return null; }
        const cleaned = { text:point.text.trim() };
        if (point.keywords !== undefined) {
          if (!Array.isArray(point.keywords) || point.keywords.some(word => !hasText(word) || !normalize(word))) problems.push(`${field}[${index}].keywords は空でない語の配列にしてください。`);
          else cleaned.keywords = [...new Set(point.keywords.map(word => word.trim()))];
        }
        if (point.min !== undefined) {
          if (!Number.isInteger(point.min) || point.min < 1 || !cleaned.keywords || point.min > new Set(cleaned.keywords.map(normalize)).size) problems.push(`${field}[${index}].min はキーワード数以下の正の整数にしてください。`);
          else cleaned.min = point.min;
        }
        return cleaned;
      });
    }
    input.cards.forEach((card, index) => {
      const problems = [], label = `カード${index + 1}${isObject(card) && hasText(card.term) ? `（${card.term}）` : ''}`;
      if (!isObject(card)) { errors.push(`${label}：オブジェクトで指定してください。`); return; }
      if (typeof card.id !== 'string' || !idPattern.test(card.id)) problems.push('id は英小文字・数字・ハイフンにしてください。');
      else if (ids.has(card.id)) problems.push(`id「${card.id}」が重複しています。`);
      else ids.add(card.id);
      if (!hasText(card.term)) problems.push('term が必要です。');
      if (!hasText(card.definition)) problems.push('definition が必要です。');
      else if (Array.from(card.definition).length > 80) problems.push('definition は80文字以内にしてください。');
      const keypoints = checkPoints(card.keypoints, 'keypoints', problems);
      const cleaned = { id:card.id, term:hasText(card.term) ? card.term.trim() : '', definition:hasText(card.definition) ? card.definition.trim() : '', keypoints, level:card.level === undefined ? 1 : card.level, aliases:[], tags:[], confusables:[], questions:[] };
      if (!Number.isInteger(cleaned.level) || cleaned.level < 1 || cleaned.level > 3) problems.push('level は1、2、3のいずれかにしてください。');
      for (const field of ['aliases','tags','confusables']) {
        if (card[field] !== undefined) {
          if (!Array.isArray(card[field]) || card[field].some(value => !hasText(value) || (field === 'confusables' && !idPattern.test(value)))) problems.push(`${field} は空でない文字列の配列にしてください。`);
          else cleaned[field] = [...new Set(card[field].map(value => value.trim()))];
        }
      }
      if (card.example !== undefined) {
        if (typeof card.example !== 'string' || Array.from(card.example).length > 50) problems.push('example は50文字以内の文字列にしてください。');
        else cleaned.example = card.example;
      }
      if (card.questions !== undefined && !Array.isArray(card.questions)) problems.push('questions は配列にしてください。');
      else if (Array.isArray(card.questions)) card.questions.forEach((question, qIndex) => {
        const field = `questions[${qIndex}]`;
        if (!isObject(question) || !['tf','number','case'].includes(question.type)) { problems.push(`${field}.type は tf、number、case のいずれかにしてください。`); return; }
        const q = { type:question.type };
        const textField = { tf:'statement', number:'question', case:'situation' }[question.type];
        if (!hasText(question[textField])) problems.push(`${field}.${textField} が必要です。`);
        else q[textField] = question[textField].trim();
        if (question.type === 'tf') {
          if (typeof question.answer !== 'boolean') problems.push(`${field}.answer は true または false にしてください。`);
          else q.answer = question.answer;
        } else if (question.type === 'number') {
          if (!Number.isFinite(question.answer)) problems.push(`${field}.answer は有限の数値にしてください。`);
          else q.answer = question.answer;
          q.tolerance = question.tolerance === undefined ? 0 : question.tolerance;
          if (!Number.isFinite(q.tolerance) || q.tolerance < 0) problems.push(`${field}.tolerance は0以上の有限の数値にしてください。`);
          if (question.unit !== undefined && typeof question.unit !== 'string') problems.push(`${field}.unit は文字列にしてください。`);
          else q.unit = question.unit || '';
        } else q.keypoints = checkPoints(question.keypoints, `${field}.keypoints`, problems);
        if (question.explain !== undefined && typeof question.explain !== 'string') problems.push(`${field}.explain は文字列にしてください。`);
        else q.explain = question.explain || '';
        cleaned.questions.push(q);
      });
      if (problems.length) errors.push(...problems.map(problem => `${label}：${problem}`));
      else cards.push(cleaned);
    });
    const metadata = { id:input.deck.id, title:input.deck.title.trim() };
    for (const field of ['source','asof']) if (input.deck[field] !== undefined) metadata[field] = input.deck[field];
    const yomi = Object.fromEntries(Object.entries(input.yomi || {}));
    return { deck:{ format:'voice-quiz/v1', deck:metadata, yomi, cards }, errors, validCount:cards.length, totalCount };
  }

  function allItems(card) {
    return ['flash','reverse','choice','explain'].map(mode => ({ key:`${card.id}:${mode}`, cardId:card.id, mode }))
      .concat((card.questions || []).map((question, qIndex) => ({ key:`${card.id}:q${qIndex}`, cardId:card.id, mode:question.type, qIndex })));
  }
  function makeProgress(item, stage, due) { return { ...item, stage, due, correct:0, wrong:0, streak:0 }; }
  function initialProgress(card, familiarity, score, settings, today) {
    const date = today || localDate(), config = sanitizeSettings(settings), progress = {}, retryKeys = [];
    const confirmed = familiarity === 'known' && !!(score && score.correct && !score.hint);
    for (const item of allItems(card)) {
      if (confirmed) progress[item.key] = makeProgress(item, 3, addDays(date, 7));
      else if (item.mode === 'flash' || RECALL_MODES.includes(item.mode) || (item.mode === 'explain' && config.explainInitially)) {
        const stage = item.mode === 'flash' && familiarity !== 'unknown' ? 1 : 0;
        progress[item.key] = makeProgress(item, stage, addDays(date, 1));
        if (item.mode === 'flash' && stage === 0) retryKeys.push(item.key);
      }
    }
    progress[`_card:${card.id}`] = { cardId:card.id, recallStreak:0, screenedAt:date };
    return { progress, retryKeys };
  }
  function reviewProgress(record, outcome, today) {
    if (outcome.held) return { ...record };
    const stage = Math.min(6, Math.max(0, Number.isInteger(record.stage) ? record.stage : 0));
    const correct = !!outcome.correct;
    const increase = outcome.perfect && ['case','explain'].includes(record.mode) ? 2 : 1;
    const next = correct ? Math.min(6, stage + (outcome.hint ? 0 : increase)) : 1;
    return { ...record, stage:next, due:addDays(today || localDate(), INTERVALS[next]), correct:(Number(record.correct) || 0) + (correct ? 1 : 0), wrong:(Number(record.wrong) || 0) + (correct ? 0 : 1), streak:correct ? (Number(record.streak) || 0) + 1 : 0, lastAnswered:today || localDate() };
  }
  function unlockItems(card, progress, today, settings) {
    const date = today || localDate(), config = sanitizeSettings(settings), additions = {};
    const items = allItems(card), records = items.map(item => progress[item.key]).filter(Boolean);
    if (!records.length && !progress[`_card:${card.id}`]) return { progress:additions };
    const meta = progress[`_card:${card.id}`] || {};
    const explain = config.explainInitially || meta.recallStreak >= 2;
    const cases = records.some(record => RECALL_MODES.includes(record.mode) && record.stage >= 2);
    for (const item of items) if (!own(progress, item.key) && ((item.mode === 'explain' && explain) || (item.mode === 'case' && cases))) additions[item.key] = makeProgress(item, 0, date);
    return { progress:additions };
  }
  function applyReview(card, previous, item, outcome, today, settings) {
    const date = today || localDate(), progress = { ...previous }, retryKeys = [];
    const record = progress[item.key] ? { ...progress[item.key], ...item } : makeProgress(item, 0, date);
    if (outcome.held) return { progress, retryKeys };
    progress[item.key] = reviewProgress(record, outcome, date);
    const metaKey = `_card:${card.id}`, meta = { cardId:card.id, recallStreak:0, ...progress[metaKey] };
    if (RECALL_MODES.includes(item.mode)) meta.recallStreak = outcome.correct ? (Number(meta.recallStreak) || 0) + 1 : 0;
    progress[metaKey] = meta;
    Object.assign(progress, unlockItems(card, progress, date, settings).progress);
    if (!outcome.correct || progress[item.key].stage === 0) retryKeys.push(item.key);
    return { progress, retryKeys };
  }
  function buildSession(decks, progress, options) {
    const opts = options || {}, records = progress || {}, today = opts.today || localDate();
    const limit = Number.isInteger(opts.questionLimit) && opts.questionLimit >= 0 ? opts.questionLimit : DEFAULT_SETTINGS.questionLimit;
    const newLimit = Number.isInteger(opts.newLimit) && opts.newLimit >= 0 ? opts.newLimit : DEFAULT_SETTINGS.newLimit;
    const learned = Number.isInteger(opts.learnedToday) && opts.learnedToday >= 0 ? opts.learnedToday : 0;
    const seen = new Set(opts.seenCardIds || []), byCard = new Map(), byKey = new Map(), result = [];
    (Array.isArray(decks) ? decks : []).forEach((deck, deckIndex) => (deck.cards || []).forEach((card, cardIndex) => {
      if (byCard.has(card.id)) return;
      const info = { card, deckId:deck.deck.id, deckIndex, cardIndex };
      byCard.set(card.id, info);
      allItems(card).forEach(item => byKey.set(item.key, { ...item, deckId:info.deckId }));
    }));
    const cardOrder = (a, b) => a.deckIndex - b.deckIndex || a.cardIndex - b.cardIndex;
    const choiceAvailable = new Set([...byCard.values()].map(info => normalize(info.card.term)).filter(Boolean)).size >= 4;
    const usable = item => item.mode !== 'choice' || choiceAvailable;
    const append = item => { if (result.length >= limit) return false; result.push(item); seen.add(item.cardId); return true; };
    if (opts.weakOnly) {
      const weak = [...byCard.values()].map(info => {
        const items = allItems(info.card).filter(item => records[item.key]);
        return { ...info, wrong:items.reduce((sum, item) => sum + (Number(records[item.key].wrong) || 0), 0), candidates:items.filter(item => usable(item) && (RECALL_MODES.includes(item.mode) || item.mode === 'explain')) };
      }).filter(info => info.wrong > 0 && info.candidates.length && !seen.has(info.card.id));
      weak.sort((a, b) => b.wrong - a.wrong || cardOrder(a, b));
      for (const info of weak) {
        info.candidates.sort((a, b) => (Number(records[b.key].wrong) || 0) - (Number(records[a.key].wrong) || 0) || String(records[a.key].due || '').localeCompare(String(records[b.key].due || '')));
        append({ ...info.candidates[0], deckId:info.deckId });
      }
      return result;
    }
    const due = [...byKey.values()].filter(item => usable(item) && records[item.key] && typeof records[item.key].due === 'string' && records[item.key].due <= today);
    due.sort((a, b) => records[a.key].due.localeCompare(records[b.key].due));
    for (const item of due) if (!seen.has(item.cardId)) append(item);
    const retryKeys = new Set(opts.retryKeys || []), includedKeys = new Set(result.map(item => item.key));
    for (const key of retryKeys) if (byKey.has(key) && usable(byKey.get(key)) && !includedKeys.has(key)) {
      if (append({ ...byKey.get(key), retry:true })) includedKeys.add(key);
    }
    const newCards = [...byCard.values()].filter(info => !seen.has(info.card.id) && !records[`_card:${info.card.id}`] && !allItems(info.card).some(item => records[item.key]));
    newCards.sort((a, b) => (a.card.level || 1) - (b.card.level || 1) || cardOrder(a, b));
    let added = 0;
    for (const info of newCards) {
      if (added >= Math.max(0, newLimit - learned)) break;
      if (append({ key:`${info.card.id}:screen`, cardId:info.card.id, mode:'screen', deckId:info.deckId, new:true })) added++;
    }
    return result;
  }

  return Object.freeze({ DEFAULT_SETTINGS, INTERVALS, RECALL_MODES, normalize, answerOnly, ...testedParsers, parseFamiliarity, parseFlash, parseSelfGrade, parseCommand, applyYomi, matchesTerm, makeChoices, gradeKeywords, selfGrade, localDate, addDays, sanitizeSettings, validateDeck, allItems, initialProgress, reviewProgress, unlockItems, applyReview, buildSession });
}));
