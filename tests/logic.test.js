'use strict';

const assert = require('node:assert/strict');
const VQ = require('../logic.js');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (error) { console.error(`失敗：${name}`); throw error; }
}
const clone = value => JSON.parse(JSON.stringify(value));
const today = '2026-11-07';
const card = {
  id:'cvr', term:'CVR', definition:'訪問者のうち成果に至った割合。', aliases:['コンバージョン率'], tags:['指標'], level:1,
  keypoints:[{ text:'成果の割合', keywords:['割合','率'], min:1 }, { text:'成果の定義', keywords:['購入','登録'], min:1 }, { text:'算出方法', keywords:['割','分母'], min:2 }],
  questions:[{ type:'tf', statement:'割合である。', answer:true }, { type:'number', question:'何％ですか。', answer:2, tolerance:0.5 }, { type:'case', situation:'売上が増えません。', keypoints:[{ text:'成果を調べる', keywords:['成果'] }] }]
};
const deckOf = (cards, id = 'sample') => ({ format:'voice-quiz/v1', deck:{ id, title:'テスト用' }, yomi:{ CVR:'シーブイアール' }, cards });
const itemOf = (sample, mode) => VQ.allItems(sample).find(item => item.mode === mode);
const progressOf = (sample, mode, stage = 1, due = today) => ({ ...itemOf(sample, mode), stage, due, correct:0, wrong:0, streak:0 });

test('正規化で全角、句読点、空白、大小文字、カタカナを揃える', () => assert.equal(VQ.normalize(' ＣＶＲ、カタカナ。！?「答え」・　'), 'cvrかたかな答え'));
test('正規化はNFKCの濁点を結合する', () => assert.equal(VQ.normalize('ﾊﾟｰｾﾝﾄ'), 'ぱーせんと'));
test('正規化はnullを空文字にする', () => assert.equal(VQ.normalize(null), ''));
test('回答の前置きと語尾だけを除く', () => assert.equal(VQ.answerOnly('答えは、わかったです。'), 'わかった'));
test('自己申告に余計な文章がある場合は採用しない', () => assert.equal(VQ.parseFlash('昨日わかった'), null));

for (const word of ['まる','マル','丸','○','◯','〇','正しい','ただしい','はい','正解','せいかい','そう']) test(`○×の正解語：${word}`, () => assert.equal(VQ.parseBoolean(word).value, true));
for (const word of ['ばつ','バツ','×','違う','ちがう','いいえ','間違い','ちがいます','違います','まちがい','間違ってる','まちがってる']) test(`○×の不正解語：${word}`, () => assert.equal(VQ.parseBoolean(word).value, false));
test('○×で語尾を除く実機版の動作を維持', () => assert.equal(VQ.parseBoolean('回答は、はいだと思います。').value, true));
test('○×で部分一致はしない', () => assert.equal(VQ.parseBoolean('はいといいえ'), null));
for (const [word, expected] of [['１番',1],['一番目です',1],['ひとつ目',1],['最初',1],['二',2],['にばん',2],['ふたつめ',2],['三番',3],['みっつめ',3],['よっつめ',4],['四つ目',4],['４つめ',4]]) test(`4択：${word}`, () => assert.equal(VQ.parseChoice(word).value, expected));
test('4択で範囲外を拒否', () => assert.equal(VQ.parseChoice('5番'), null));
test('4択で余分な語を拒否', () => assert.equal(VQ.parseChoice('2番か3番'), null));
for (const [word, expected] of [['答えは２％',2],['二点五',2.5],['マイナス三てん一四',-3.14],['プラス１２',12],['一万二千三百四十五',12345],['一億二千万',120000000],['二〇二六',2026],['1,234.50',1234.5],['零点〇五',0.05],['千',1000],['兆',1000000000000]]) test(`数字：${word}`, () => assert.equal(VQ.parseNumber(word).value, expected));
test('数字のない発話を拒否', () => assert.equal(VQ.parseNumber('わかりません'), null));
test('安全な整数の範囲外を拒否', () => assert.equal(VQ.parseNumber('999999999999999999999'), null));
test('数字は実機版の抽出トークンを返す', () => assert.equal(VQ.parseNumber('約二十人').token, '二十'));

for (const word of ['わかった','わかる','わかります','知ってる','知ってます','はい']) test(`flash肯定：${word}`, () => assert.equal(VQ.parseFlash(word).value, true));
for (const word of ['わからない','わかりません','知らない','知りません','いいえ']) test(`flash否定：${word}`, () => assert.equal(VQ.parseFlash(word).value, false));
for (const word of ['うろ覚え','うろおぼえ','なんとなく','たぶん','少し']) test(`ふるい分け曖昧：${word}`, () => assert.equal(VQ.parseFamiliarity(word).value, 'vague'));
test('ふるい分け知ってる', () => assert.equal(VQ.parseFamiliarity('知ってます').value, 'known'));
test('ふるい分け知らない', () => assert.equal(VQ.parseFamiliarity('知らない').value, 'unknown'));
test('ふるい分け不明', () => assert.equal(VQ.parseFamiliarity('だいたい全部'), null));
for (const [word, expected] of [['言えた','all'],['半分','half'],['言えなかった','none']]) test(`自己採点：${word}`, () => assert.equal(VQ.parseSelfGrade(word).value, expected));
for (const [word, expected] of [['もう一回','repeat'],['もう一度','repeat'],['ヒント','hint'],['スキップ','skip'],['止めて','pause'],['ストップ','pause'],['一時停止','pause'],['再開','resume'],['続けて','resume'],['終わり','finish'],['終了','finish']]) test(`声の命令：${word}`, () => assert.equal(VQ.parseCommand(word).value, expected));
test('文中の命令語を命令にしない', () => assert.equal(VQ.parseCommand('ヒントを出す機能'), null));

test('yomiは長いキーを先に適用', () => assert.equal(VQ.applyYomi('CVRとCV', { CV:'シーブイ', CVR:'シーブイアール' }), 'シーブイアールとシーブイ'));
test('yomiは置換後の読みを再び置換しない', () => assert.equal(VQ.applyYomi('A', { A:'B', B:'C' }), 'B'));
test('yomiの正規表現記号を普通の文字として扱う', () => assert.equal(VQ.applyYomi('C++とC+', { 'C+':'短い', 'C++':'長い' }), '長いと短い'));
test('yomiがない文はそのまま', () => assert.equal(VQ.applyYomi('文章'), '文章'));
test('逆引きは用語の部分一致', () => assert.equal(VQ.matchesTerm('答えはｃｖｒです', card), true));
test('逆引きは別名のかな表記を吸収', () => assert.equal(VQ.matchesTerm('こんばーじょん率です', card), true));
test('逆引きは読み辞書を使う', () => assert.equal(VQ.matchesTerm('シーブイアールです', card, { CVR:'シーブイアール' }), true));
test('逆引きは空の別名に一致しない', () => assert.equal(VQ.matchesTerm('無関係', { term:'', aliases:[''] }), false));
test('逆引きは異なる用語に一致しない', () => assert.equal(VQ.matchesTerm('CTR', card), false));
test('4択は正解と3枚の異なるカードを返す', () => {
  const samples = ['correct','one','two','three','four'].map(id => ({ ...clone(card), id, term:id }));
  const choices = VQ.makeChoices(samples[0], samples, () => 0.5);
  assert.equal(choices.length, 4); assert.equal(choices.filter(choice => choice.id === 'correct').length, 1); assert.equal(new Set(choices.map(choice => choice.id)).size, 4);
});
test('4択はconfusablesを優先する', () => {
  const samples = ['correct','one','two','three','four','five'].map(id => ({ ...clone(card), id, term:id, tags:[] }));
  samples[0].confusables = ['three','four','five'];
  assert.deepEqual(VQ.makeChoices(samples[0], samples, () => 0.5).map(choice => choice.id).sort(), ['correct','five','four','three']);
});
test('4択は足りない場合同じタグを優先する', () => {
  const samples = ['correct','same','different','confusing','last'].map(id => ({ ...clone(card), id, term:id, tags:[] }));
  samples[0].confusables = ['confusing']; samples[0].tags = ['共通']; samples[1].tags = ['共通']; samples[4].tags = ['共通'];
  assert.deepEqual(VQ.makeChoices(samples[0], samples, () => 0.5).map(choice => choice.id).sort(), ['confusing','correct','last','same']);
});
test('4択は表記ゆれのある同じ用語を重複させない', () => {
  const samples = ['ＣＶＲ','cvr','カタカナ','かたかな','独自'].map((term, index) => ({ ...clone(card), id:`id-${index}`, term }));
  const choices = VQ.makeChoices(samples[0], samples, () => 0);
  assert.equal(choices.length, 3); assert.equal(new Set(choices.map(choice => VQ.normalize(choice.term))).size, 3);
});
test('4択の候補が足りなければある分だけ返す', () => assert.equal(VQ.makeChoices(card, [card], () => 0).length, 1));
test('4択作成は入力配列やカードを変更しない', () => {
  const samples = ['a','b','c','d'].map(id => ({ ...clone(card), id, term:id })), saved = clone(samples);
  VQ.makeChoices(samples[0], samples, () => 0.25); assert.deepEqual(samples, saved);
});

test('キーワードは半分以上で正解、全要点なら完璧', () => {
  const score = VQ.gradeKeywords('購入の割合を分母で割ります', card.keypoints);
  assert.equal(score.correct, true); assert.equal(score.perfect, true); assert.deepEqual(score.hits, [0,1,2]); assert.deepEqual(score.missed, []);
});
test('min語に届かない要点は不一致', () => {
  const score = VQ.gradeKeywords('割合を割ります', card.keypoints);
  assert.equal(score.correct, false); assert.equal(score.matched, 1); assert.deepEqual(score.missed, ['成果の定義','算出方法']);
});
test('奇数の要点の半分は切り上げ', () => {
  const score = VQ.gradeKeywords('登録する割合', card.keypoints);
  assert.equal(score.correct, true); assert.equal(score.perfect, false); assert.equal(score.matched, 2);
});
test('重複したキーワードでminを水増ししない', () => assert.equal(VQ.gradeKeywords('CVR', [{ text:'用語', keywords:['CVR','ｃｖｒ'], min:2 }]).matched, 0));
test('文字列要点があれば自己採点が必要', () => assert.equal(VQ.gradeKeywords('説明', ['要点', { text:'別の要点', keywords:['説明'] }]).needsSelfGrade, true));
test('keywords省略でも自己採点が必要', () => assert.equal(VQ.gradeKeywords('説明', [{ text:'要点' }]).needsSelfGrade, true));
test('空の要点は正解や完璧にならない', () => { const score = VQ.gradeKeywords('', []); assert.equal(score.correct, false); assert.equal(score.perfect, false); });
test('自己採点「言えた」は完璧', () => assert.equal(VQ.selfGrade('all', card.keypoints).perfect, true));
test('自己採点「半分」は正解で完璧ではない', () => { const score = VQ.selfGrade('half', card.keypoints); assert.equal(score.correct, true); assert.equal(score.perfect, false); });
test('要点1つの自己採点「半分」も完璧ではない', () => assert.equal(VQ.selfGrade('half', ['要点']).perfect, false));
test('自己採点「言えなかった」は不正解', () => assert.equal(VQ.selfGrade('none', card.keypoints).correct, false));
test('自己採点「半分」は特定の要点を言えたとは断定しない', () => {
  const score = VQ.selfGrade('half', card.keypoints);
  assert.equal(score.selfReported, true); assert.equal(score.matched, 2); assert.deepEqual(score.hits, []); assert.deepEqual(score.missed, []); assert.deepEqual(score.unconfirmed, card.keypoints.map(point => point.text));
});
test('自己採点「言えた」は全要点を言えたとして未確認なし', () => {
  const score = VQ.selfGrade('all', card.keypoints);
  assert.equal(score.selfReported, true); assert.deepEqual(score.hits, [0,1,2]); assert.deepEqual(score.missed, []); assert.deepEqual(score.unconfirmed, []);
});
test('自己採点「言えなかった」は全要点を不足として未確認なし', () => {
  const score = VQ.selfGrade('none', card.keypoints);
  assert.equal(score.selfReported, true); assert.deepEqual(score.hits, []); assert.deepEqual(score.missed, card.keypoints.map(point => point.text)); assert.deepEqual(score.unconfirmed, []);
});

test('ローカル日付を使う', () => assert.equal(VQ.localDate(new Date(2026, 10, 7, 23, 59)), today));
for (const [date, days, expected] of [['2026-11-30',1,'2026-12-01'],['2026-12-31',1,'2027-01-01'],['2028-02-28',1,'2028-02-29'],['2026-03-01',-1,'2026-02-28']]) test(`日付加算：${date}`, () => assert.equal(VQ.addDays(date, days), expected));
test('不正な日付を拒否', () => assert.throws(() => VQ.addDays('2026-02-30', 1), TypeError));
test('不正な日数を拒否', () => assert.throws(() => VQ.addDays(today, NaN), TypeError));
test('設定の初期値', () => assert.deepEqual(VQ.sanitizeSettings(null), VQ.DEFAULT_SETTINGS));
test('許可された設定だけ保存する', () => {
  const value = VQ.sanitizeSettings({ voice:'Kyoko', rate:1.2, answerTime:15, questionLimit:30, minutes:20, newLimit:5, explainInitially:true, cue:false, extra:true });
  assert.deepEqual(value, { voice:'Kyoko', rate:1.2, answerTime:15, questionLimit:30, minutes:20, newLimit:5, explainInitially:true, cue:false });
});
test('範囲外の設定は初期値', () => assert.deepEqual(VQ.sanitizeSettings({ rate:3, answerTime:1, questionLimit:2, minutes:3, newLimit:1, cue:'yes' }), VQ.DEFAULT_SETTINGS));

test('デッキ形式を検査して全モードを保つ', () => {
  const result = VQ.validateDeck(deckOf([card]));
  assert.equal(result.validCount, 1); assert.equal(result.totalCount, 1); assert.deepEqual(result.errors, []); assert.equal(result.deck.cards[0].questions.length, 3);
});
test('文字列要点も有効', () => { const sample = clone(card); sample.keypoints = ['要点']; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 1); });
test('keywordsがない要点も有効', () => { const sample = clone(card); sample.keypoints = [{ text:'要点' }]; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 1); });
test('任意項目を省略できる', () => {
  const result = VQ.validateDeck(deckOf([{ id:'minimal', term:'用語', definition:'意味', keypoints:['要点'] }]));
  assert.equal(result.validCount, 1); assert.equal(result.deck.cards[0].level, 1); assert.deepEqual(result.deck.cards[0].questions, []);
});
for (const field of ['term','definition','keypoints','id']) test(`必須項目の欠落：${field}`, () => {
  const sample = clone(card); delete sample[field]; const result = VQ.validateDeck(deckOf([sample]));
  assert.equal(result.validCount, 0); assert.ok(result.errors.some(error => error.includes(field)));
});
for (const id of ['Upper','日本語','bad_id','bad:id','']) test(`不正なID：${id}`, () => { const sample = clone(card); sample.id = id; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('カードの数値IDを拒否する', () => { const sample = clone(card); sample.id = 123; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('デッキの数値IDを拒否する', () => { const sample = deckOf([card]); sample.deck.id = 123; assert.equal(VQ.validateDeck(sample).deck, null); });
test('重複IDのカードを除外', () => { const result = VQ.validateDeck(deckOf([card, clone(card)])); assert.equal(result.validCount, 1); assert.ok(result.errors.some(error => error.includes('重複'))); });
test('エラーのあるカードだけ除外', () => { const sample = clone(card); sample.id = 'bad'; sample.definition = ''; const result = VQ.validateDeck(deckOf([card, sample])); assert.equal(result.validCount, 1); assert.equal(result.totalCount, 2); assert.equal(result.deck.cards[0].id, 'cvr'); });
test('未対応の問題typeはカードごと除外', () => { const sample = clone(card); sample.questions[0].type = 'ai'; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('○×の文字列answerを拒否', () => { const sample = clone(card); sample.questions[0].answer = 'true'; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('数字の無限大answerを拒否', () => { const sample = clone(card); sample.questions[1].answer = Infinity; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('数字の負のtoleranceを拒否', () => { const sample = clone(card); sample.questions[1].tolerance = -1; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('数字のtolerance省略は0', () => { const sample = clone(card); delete sample.questions[1].tolerance; assert.equal(VQ.validateDeck(deckOf([sample])).deck.cards[0].questions[1].tolerance, 0); });
test('ケースの要点欠落を拒否', () => { const sample = clone(card); delete sample.questions[2].keypoints; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('minがキーワード数を超えたら拒否', () => { const sample = clone(card); sample.keypoints[0].min = 3; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('空のkeywordsを含むカードを拒否', () => { const sample = clone(card); sample.keypoints[0].keywords = ['']; assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('definitionの文字数上限', () => { const sample = clone(card); sample.definition = 'あ'.repeat(81); assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('exampleの文字数上限', () => { const sample = clone(card); sample.example = 'あ'.repeat(51); assert.equal(VQ.validateDeck(deckOf([sample])).validCount, 0); });
test('誤ったformatはデッキごと拒否', () => { const sample = deckOf([card]); sample.format = 'other'; assert.equal(VQ.validateDeck(sample).deck, null); });
test('cardsが配列でなければ拒否', () => { const sample = deckOf([card]); sample.cards = {}; assert.equal(VQ.validateDeck(sample).deck, null); });
test('yomiの値が文字列でなければ拒否', () => { const sample = deckOf([card]); sample.yomi.CVR = 3; assert.equal(VQ.validateDeck(sample).deck, null); });
test('検査は入力を変更しない', () => { const sample = deckOf([card]), before = clone(sample); VQ.validateDeck(sample); assert.deepEqual(sample, before); });
test('検査で未知のフィールドを取り除く', () => { const sample = clone(card); sample.untrusted = '<img>'; const result = VQ.validateDeck(deckOf([sample])); assert.equal(result.deck.cards[0].untrusted, undefined); });

test('項目キーはカードとモードまたは質問index', () => assert.deepEqual(VQ.allItems(card).map(item => item.key), ['cvr:flash','cvr:reverse','cvr:choice','cvr:explain','cvr:q0','cvr:q1','cvr:q2']));
test('知らないはflash段階0と再出題、recall段階0で翌日', () => {
  const result = VQ.initialProgress(card, 'unknown', null, {}, today);
  assert.deepEqual(result.retryKeys, ['cvr:flash']);
  for (const mode of ['flash','reverse','choice','tf','number']) { const record = result.progress[itemOf(card, mode).key]; assert.equal(record.stage, 0); assert.equal(record.due, '2026-11-08'); }
  assert.equal(result.progress['cvr:explain'], undefined); assert.equal(result.progress['cvr:q2'], undefined);
});
test('うろ覚えはflash段階1でrecall段階0', () => {
  const result = VQ.initialProgress(card, 'vague', null, {}, today);
  assert.equal(result.progress['cvr:flash'].stage, 1); assert.equal(result.progress['cvr:reverse'].stage, 0); assert.deepEqual(result.retryKeys, []);
});
test('知ってる説明正解は全項目段階3で7日後', () => {
  const result = VQ.initialProgress(card, 'known', { correct:true, perfect:false }, {}, today);
  for (const item of VQ.allItems(card)) { assert.equal(result.progress[item.key].stage, 3); assert.equal(result.progress[item.key].due, '2026-11-14'); }
});
test('知ってる説明失敗はflash段階1とrecall段階0で説明未解放', () => {
  const result = VQ.initialProgress(card, 'known', { correct:false }, {}, today);
  assert.equal(result.progress['cvr:flash'].stage, 1); assert.equal(result.progress['cvr:reverse'].stage, 0); assert.equal(result.progress['cvr:explain'], undefined);
});
test('知ってる説明でヒントを使った場合は段階3へ飛ばさない', () => {
  const result = VQ.initialProgress(card, 'known', { correct:true, perfect:true, hint:true }, {}, today);
  assert.equal(result.progress['cvr:flash'].stage, 1); assert.equal(result.progress['cvr:reverse'].stage, 0); assert.equal(result.progress['cvr:explain'], undefined);
});
for (const familiarity of ['unknown','vague','known']) test(`説明を最初から出す：${familiarity}`, () => {
  const result = VQ.initialProgress(card, familiarity, { correct:false }, { explainInitially:true }, today);
  assert.equal(result.progress['cvr:explain'].stage, 0); assert.equal(result.progress['cvr:explain'].due, '2026-11-08');
});
test('初回ふるい分け日をカードメタに記録', () => assert.equal(VQ.initialProgress(card, 'vague', null, {}, today).progress['_card:cvr'].screenedAt, today));
for (let stage = 0; stage <= 6; stage++) test(`正解で段階を上げる：${stage}`, () => {
  const result = VQ.reviewProgress(progressOf(card, 'reverse', stage), { correct:true }, today), next = Math.min(stage + 1, 6);
  assert.equal(result.stage, next); assert.equal(result.due, VQ.addDays(today, VQ.INTERVALS[next])); assert.equal(result.correct, 1); assert.equal(result.wrong, 0);
});
for (const mode of ['case','explain']) test(`完璧で2段階上げる：${mode}`, () => assert.equal(VQ.reviewProgress(progressOf(card, mode, 2), { correct:true, perfect:true }, today).stage, 4));
test('recallはperfectが指定されても1段階', () => assert.equal(VQ.reviewProgress(progressOf(card, 'reverse', 2), { correct:true, perfect:true }, today).stage, 3));
test('完璧でも上限6', () => assert.equal(VQ.reviewProgress(progressOf(card, 'explain', 5), { correct:true, perfect:true }, today).stage, 6));
test('ヒント使用時は完璧でも段階を上げない', () => { const result = VQ.reviewProgress(progressOf(card, 'explain', 2), { correct:true, perfect:true, hint:true }, today); assert.equal(result.stage, 2); assert.equal(result.due, '2026-11-10'); });
test('不正解は段階1、翌日、連続正解をリセット', () => { const result = VQ.reviewProgress({ ...progressOf(card, 'reverse', 5), streak:5, wrong:2 }, { correct:false }, today); assert.equal(result.stage, 1); assert.equal(result.due, '2026-11-08'); assert.equal(result.streak, 0); assert.equal(result.wrong, 3); });
test('保留は段階や期限や回数を変えない', () => { const before = progressOf(card, 'case', 4); assert.deepEqual(VQ.reviewProgress(before, { held:true }, today), before); });
test('復習は未知の付随データを保持して入力を変更しない', () => { const before = { ...progressOf(card, 'reverse', 1), extra:'保持' }, saved = clone(before); const after = VQ.reviewProgress(before, { correct:true }, today); assert.equal(after.extra, '保持'); assert.deepEqual(before, saved); });
test('recallが2回連続正解で説明を即日解放', () => {
  let progress = VQ.initialProgress(card, 'vague', null, {}, today).progress;
  progress = VQ.applyReview(card, progress, itemOf(card, 'reverse'), { correct:true }, today, {}).progress;
  assert.equal(progress['cvr:explain'], undefined);
  progress = VQ.applyReview(card, progress, itemOf(card, 'choice'), { correct:true }, today, {}).progress;
  assert.equal(progress['cvr:explain'].due, today); assert.equal(progress['cvr:explain'].stage, 0); assert.equal(progress['_card:cvr'].recallStreak, 2);
});
test('recallの不正解を挟むと2回連続を数え直す', () => {
  let progress = VQ.initialProgress(card, 'vague', null, {}, today).progress;
  for (const correct of [true,false,true]) progress = VQ.applyReview(card, progress, itemOf(card, 'reverse'), { correct }, today, {}).progress;
  assert.equal(progress['cvr:explain'], undefined); assert.equal(progress['_card:cvr'].recallStreak, 1);
});
test('flash正解はrecall連続回数に含めない', () => {
  let progress = VQ.initialProgress(card, 'vague', null, {}, today).progress;
  for (let i = 0; i < 2; i++) progress = VQ.applyReview(card, progress, itemOf(card, 'flash'), { correct:true }, today, {}).progress;
  assert.equal(progress['cvr:explain'], undefined); assert.equal(progress['_card:cvr'].recallStreak, 0);
});
test('recall段階2でケースを解放', () => {
  const progress = { 'cvr:reverse':progressOf(card, 'reverse', 2) }, result = VQ.unlockItems(card, progress, today, {});
  assert.equal(result.progress['cvr:q2'].stage, 0); assert.equal(result.progress['cvr:q2'].due, today);
});
test('recall段階1ではケースを解放しない', () => assert.equal(VQ.unlockItems(card, { 'cvr:reverse':progressOf(card, 'reverse', 1) }, today, {}).progress['cvr:q2'], undefined));
test('flash段階2でもケースを解放しない', () => assert.equal(VQ.unlockItems(card, { 'cvr:flash':progressOf(card, 'flash', 2) }, today, {}).progress['cvr:q2'], undefined));
test('解放済み説明の段階を上書きしない', () => {
  const progress = { 'cvr:explain':progressOf(card, 'explain', 5), '_card:cvr':{ recallStreak:2 } };
  assert.equal(VQ.unlockItems(card, progress, today, {}).progress['cvr:explain'], undefined);
});
test('未学習カードを設定変更だけで解放しない', () => assert.deepEqual(VQ.unlockItems(card, {}, today, { explainInitially:true }).progress, {}));
test('不正解は再出題キーを返す', () => { const progress = VQ.initialProgress(card, 'vague', null, {}, today).progress; assert.deepEqual(VQ.applyReview(card, progress, itemOf(card, 'reverse'), { correct:false }, today, {}).retryKeys, ['cvr:reverse']); });
test('applyReviewの保留は全データ不変で再出題なし', () => { const progress = VQ.initialProgress(card, 'vague', null, {}, today).progress, result = VQ.applyReview(card, progress, itemOf(card, 'reverse'), { held:true }, today, {}); assert.deepEqual(result.progress, progress); assert.deepEqual(result.retryKeys, []); });
test('デッキ更新で質問typeが変わっても現在のmodeで採点する', () => {
  const sample = clone(card); sample.questions[0] = { type:'case', situation:'相談', keypoints:['要点'] };
  const old = { 'cvr:q0':progressOf(card, 'tf', 2) }, item = VQ.allItems(sample).find(entry => entry.qIndex === 0);
  const result = VQ.applyReview(sample, old, item, { correct:true, perfect:true }, today, {});
  assert.equal(result.progress['cvr:q0'].mode, 'case'); assert.equal(result.progress['cvr:q0'].qIndex, 0); assert.equal(result.progress['cvr:q0'].stage, 4);
});

const makeCard = (id, level = 1) => ({ ...clone(card), id, term:id.toUpperCase(), level });
const cards = ['a','b','c','d','e','f'].map((id, index) => makeCard(id, index % 3 + 1));
const sessionDecks = [deckOf(cards.slice(0, 3), 'first'), deckOf(cards.slice(3), 'second')];
test('復習は期限の古い順、その後新しいカード', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1, '2026-11-05'), 'b:flash':progressOf(cards[1], 'flash', 1, '2026-11-02') };
  const result = VQ.buildSession(sessionDecks, progress, { today, questionLimit:4, newLimit:2 });
  assert.deepEqual(result.map(item => item.key), ['b:flash','a:reverse','d:screen','e:screen']);
});
test('順番は復習、再出題、新規', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1, today), 'b:flash':progressOf(cards[1], 'flash', 1, '2026-11-08') };
  const result = VQ.buildSession(sessionDecks, progress, { today, questionLimit:4, newLimit:2, retryKeys:['b:flash'] });
  assert.deepEqual(result.map(item => item.key), ['a:reverse','b:flash','d:screen','e:screen']); assert.equal(result[1].retry, true);
});
test('新規はlevel昇順の後にデッキ順', () => assert.deepEqual(VQ.buildSession(sessionDecks, {}, { today, questionLimit:6, newLimit:6 }).map(item => item.cardId), ['a','d','b','e','c','f']));
test('同一カードの別モードを出さない', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1), 'a:choice':progressOf(cards[0], 'choice', 1) };
  const result = VQ.buildSession(sessionDecks, progress, { today, questionLimit:6, newLimit:0 }); assert.deepEqual(result.map(item => item.key), ['a:reverse']);
});
test('同じカードの別モードをseenで除外', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1) };
  assert.deepEqual(VQ.buildSession(sessionDecks, progress, { today, questionLimit:6, newLimit:0, seenCardIds:new Set(['a']) }), []);
});
test('再出題は同じカードでも許可する', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1, '2026-11-08') };
  const result = VQ.buildSession(sessionDecks, progress, { today, questionLimit:6, newLimit:0, seenCardIds:['a'], retryKeys:['a:reverse'] }); assert.equal(result.length, 1); assert.equal(result[0].retry, true);
});
test('再出題キーの重複を除く', () => {
  const result = VQ.buildSession(sessionDecks, {}, { today, questionLimit:6, newLimit:0, retryKeys:['a:reverse','a:reverse'] }); assert.equal(result.length, 1);
});
test('存在しないカードの再出題を無視する', () => assert.deepEqual(VQ.buildSession(sessionDecks, {}, { today, newLimit:0, retryKeys:['removed:flash'] }), []));
test('問題数の上限を守る', () => assert.equal(VQ.buildSession(sessionDecks, {}, { today, questionLimit:2, newLimit:6 }).length, 2));
test('問題数0なら空', () => assert.deepEqual(VQ.buildSession(sessionDecks, {}, { today, questionLimit:0, newLimit:6 }), []));
test('本日学んだカード数を新規上限から引く', () => assert.equal(VQ.buildSession(sessionDecks, {}, { today, questionLimit:6, newLimit:5, learnedToday:3 }).length, 2));
test('本日の上限到達後は新規なし', () => assert.deepEqual(VQ.buildSession(sessionDecks, {}, { today, questionLimit:6, newLimit:5, learnedToday:8 }), []));
test('未到来の復習を通常の出題に含めない', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1, '2026-11-08') }; assert.deepEqual(VQ.buildSession(sessionDecks, progress, { today, newLimit:0 }), []);
});
test('卒業段階も60日後に復習する', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 6, today) }; assert.equal(VQ.buildSession(sessionDecks, progress, { today, newLimit:0 }).length, 1);
});
test('メタだけある既知カードは新規に戻さない', () => {
  const result = VQ.buildSession([deckOf([cards[0]])], { '_card:a':{ screenedAt:today } }, { today, questionLimit:6, newLimit:6 }); assert.deepEqual(result, []);
});
test('削除された問題の進み具合を無視する', () => assert.deepEqual(VQ.buildSession(sessionDecks, { 'a:q99':{ cardId:'a', mode:'tf', due:today } }, { today, newLimit:0 }), []));
test('同じIDが別デッキにあっても一つにする', () => assert.equal(VQ.buildSession([deckOf([card], 'one'),deckOf([card], 'two')], {}, { today, newLimit:5 }).length, 1));
test('苦手モードは不正解の多いカード順で期限を無視', () => {
  const progress = { 'a:reverse':{ ...progressOf(cards[0], 'reverse', 4, '2027-01-01'), wrong:1 }, 'b:choice':{ ...progressOf(cards[1], 'choice', 4, '2027-01-01'), wrong:3 } };
  const result = VQ.buildSession(sessionDecks, progress, { today, weakOnly:true, questionLimit:5 }); assert.deepEqual(result.map(item => item.key), ['b:choice','a:reverse']);
});
test('苦手モードはflashとcaseを出さない', () => {
  const progress = { 'a:flash':{ ...progressOf(cards[0], 'flash', 1), wrong:10 }, 'a:reverse':progressOf(cards[0], 'reverse', 1), 'a:q2':{ ...progressOf(cards[0], 'case', 1), wrong:20 } };
  const result = VQ.buildSession(sessionDecks, progress, { today, weakOnly:true, questionLimit:5 }); assert.equal(result[0].mode, 'reverse');
});
test('苦手モードは解放済み説明を出せる', () => {
  const progress = { 'a:explain':{ ...progressOf(cards[0], 'explain', 1), wrong:2 } }; assert.equal(VQ.buildSession(sessionDecks, progress, { today, weakOnly:true })[0].mode, 'explain');
});
test('苦手モードでも一回一カードを守る', () => {
  const progress = { 'a:reverse':{ ...progressOf(cards[0], 'reverse', 1), wrong:2 }, 'a:choice':{ ...progressOf(cards[0], 'choice', 1), wrong:3 } }; assert.equal(VQ.buildSession(sessionDecks, progress, { today, weakOnly:true }).length, 1);
});
test('苦手モードで新規を出さない', () => assert.deepEqual(VQ.buildSession(sessionDecks, {}, { today, weakOnly:true }), []));
test('用語が4種類未満のとき4択を通常出題しない', () => {
  const progress = { 'cvr:choice':progressOf(card, 'choice', 1) };
  assert.deepEqual(VQ.buildSession([deckOf([card])], progress, { today, newLimit:0 }), []);
});
test('用語が4種類未満のとき4択の再出題もしない', () => {
  assert.deepEqual(VQ.buildSession([deckOf([card])], {}, { today, newLimit:0, retryKeys:['cvr:choice'] }), []);
});
test('セッション構築は入力を変更しない', () => {
  const progress = { 'a:reverse':progressOf(cards[0], 'reverse', 1) }, before = clone(progress), decks = clone(sessionDecks);
  VQ.buildSession(sessionDecks, progress, { today, questionLimit:5, newLimit:5 }); assert.deepEqual(progress, before); assert.deepEqual(sessionDecks, decks);
});
test('空のデッキでも落ちない', () => assert.deepEqual(VQ.buildSession([], {}, { today }), []));

console.log(`${passed}件のテストに成功しました。`);
