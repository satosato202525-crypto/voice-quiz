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
test('ふるい分け部分一致：もう覚えうる覚え', () => assert.equal(VQ.parseFamiliarity('もう覚えうる覚え').value, 'vague'));
test('ふるい分け部分一致：ちょっと', () => assert.equal(VQ.parseFamiliarity('ちょっと').value, 'vague'));
test('ふるい分け部分一致：すこし', () => assert.equal(VQ.parseFamiliarity('すこし').value, 'vague'));
test('ふるい分け部分一致：覚え', () => assert.equal(VQ.parseFamiliarity('覚え').value, 'vague'));
test('ふるい分け部分一致：おぼえ', () => assert.equal(VQ.parseFamiliarity('おぼえ').value, 'vague'));
test('ふるい分け部分一致：多分', () => assert.equal(VQ.parseFamiliarity('多分').value, 'vague'));
test('ふるい分け部分一致：半分', () => assert.equal(VQ.parseFamiliarity('半分').value, 'vague'));
test('ふるい分け部分一致：はい少し', () => assert.equal(VQ.parseFamiliarity('はい少し').value, 'vague'));
test('ふるい分け部分一致： スコシ。', () => assert.equal(VQ.parseFamiliarity(' スコシ。').value, 'vague'));
test('ふるい分け部分一致：知ってる', () => assert.equal(VQ.parseFamiliarity('知ってる').value, 'known'));
test('ふるい分け部分一致：はい', () => assert.equal(VQ.parseFamiliarity('はい').value, 'known'));
test('ふるい分け部分一致：しってます', () => assert.equal(VQ.parseFamiliarity('しってます').value, 'known'));
test('ふるい分け部分一致：知りません', () => assert.equal(VQ.parseFamiliarity('知りません').value, 'unknown'));
test('ふるい分け部分一致：しらない', () => assert.equal(VQ.parseFamiliarity('しらない').value, 'unknown'));
test('ふるい分け部分一致：しりません', () => assert.equal(VQ.parseFamiliarity('しりません').value, 'unknown'));
test('ふるい分け部分一致：わからない', () => assert.equal(VQ.parseFamiliarity('わからない').value, 'unknown'));
test('ふるい分け部分一致：わかりません', () => assert.equal(VQ.parseFamiliarity('わかりません').value, 'unknown'));
test('ふるい分け部分一致：いいえ', () => assert.equal(VQ.parseFamiliarity('いいえ').value, 'unknown'));
test('ふるい分け部分一致：知ってるけど少し知らない', () => assert.equal(VQ.parseFamiliarity('知ってるけど少し知らない').value, 'unknown'));
test('ふるい分け番号：1', () => assert.equal(VQ.parseFamiliarity('1').value, 'known'));
test('ふるい分け番号：いち', () => assert.equal(VQ.parseFamiliarity('いち').value, 'known'));
test('ふるい分け番号：1番', () => assert.equal(VQ.parseFamiliarity('1番').value, 'known'));
test('ふるい分け番号：一番', () => assert.equal(VQ.parseFamiliarity('一番').value, 'known'));
test('ふるい分け番号：2', () => assert.equal(VQ.parseFamiliarity('2').value, 'vague'));
test('ふるい分け番号：に', () => assert.equal(VQ.parseFamiliarity('に').value, 'vague'));
test('ふるい分け番号：2番', () => assert.equal(VQ.parseFamiliarity('2番').value, 'vague'));
test('ふるい分け番号：二番', () => assert.equal(VQ.parseFamiliarity('二番').value, 'vague'));
test('ふるい分け番号：3', () => assert.equal(VQ.parseFamiliarity('3').value, 'unknown'));
test('ふるい分け番号：さん', () => assert.equal(VQ.parseFamiliarity('さん').value, 'unknown'));
test('ふるい分け番号：3番', () => assert.equal(VQ.parseFamiliarity('3番').value, 'unknown'));
test('ふるい分け番号：三番', () => assert.equal(VQ.parseFamiliarity('三番').value, 'unknown'));
test('ふるい分け番号：答えは、２番です。', () => assert.equal(VQ.parseFamiliarity('答えは、２番です。').value, 'vague'));
test('ふるい分け対象外：りんご', () => assert.equal(VQ.parseFamiliarity('りんご'), null));
test('ふるい分け対象外：2番か3番', () => assert.equal(VQ.parseFamiliarity('2番か3番'), null));

test('ふるい分け知ってる', () => assert.equal(VQ.parseFamiliarity('知ってます').value, 'known'));
test('ふるい分け知らない', () => assert.equal(VQ.parseFamiliarity('知らない').value, 'unknown'));
test('ふるい分け不明', () => assert.equal(VQ.parseFamiliarity('だいたい全部'), null));
for (const [word, expected] of [['言えた','all'],['半分','half'],['言えなかった','none']]) test(`自己採点：${word}`, () => assert.equal(VQ.parseSelfGrade(word).value, expected));
for (const [word, expected] of [['もう一回','repeat'],['もう一度','repeat'],['ヒント','hint'],['スキップ','skip']]) test(`声の命令：${word}`, () => assert.equal(VQ.parseCommand(word).value, expected));
for (const word of ['止めて','とめて','終わり','おわり','再開','さいかい','ストップ','一時停止','いちじていし','続けて','つづけて','終了','しゅうりょう']) test(`停止・再開の言葉を命令にしない：${word}`, () => assert.equal(VQ.parseCommand(word), null));
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

const resumeTiming = {remainingMs:123456, interruptedAt:1794000000000};
function resumeContext() {
  return {
    reviews:[itemOf(card, 'reverse')], retries:[{...itemOf(card, 'flash'), retry:true}],
    fresh:[{key:'new:screen', cardId:'new', mode:'screen', new:true}], tail:[itemOf(card, 'explain')],
    currentItem:itemOf(card, 'number'), answered:3, correct:2,
    missed:[{term:'CVR', text:'成果の定義'}],
    pending:[{key:'cvr:q0', cardId:'cvr', term:'CVR', mode:'tf', date:today, prompt:'割合ですか'}],
    retried:new Set(['cvr:flash']), started:1793999000000, pausedMs:25000,
    settingsSnapshot:{...VQ.DEFAULT_SETTINGS, rate:1.1, minutes:5}
  };
}
test('中断では未確定の項目を残りキューの最初に戻す', () => {
  const ctx = resumeContext(), before = clone({...ctx, retried:[...ctx.retried]});
  const saved = VQ.buildResume(ctx, resumeTiming);
  assert.deepEqual(saved.reviews.map(item => item.key), ['cvr:q1','cvr:reverse']);
  for (const name of ['retries','fresh','tail']) assert.deepEqual(saved[name], ctx[name]);
  assert.deepEqual(clone({...ctx, retried:[...ctx.retried]}), before);
});
test('判定済みの項目はキューに戻さない', () => {
  const ctx = resumeContext(); ctx.currentItem = null;
  assert.deepEqual(VQ.buildResume(ctx, resumeTiming).reviews, ctx.reviews);
});
for (const name of ['reviews','retries','fresh','tail']) test(`どのキューの途中でも再開の最初に出す：${name}`, () => {
  const ctx = resumeContext(); ctx.currentItem = ctx[name].shift();
  const saved = VQ.buildResume(ctx, resumeTiming);
  assert.equal(saved.reviews[0].key, ctx.currentItem.key); assert.deepEqual(saved[name].slice(name === 'reviews' ? 1 : 0), ctx[name]);
});
test('中断情報は集計・時刻・残り時間・設定・再出題済みキーを保存する', () => {
  const ctx = resumeContext(), saved = VQ.buildResume(ctx, resumeTiming);
  for (const key of ['answered','correct','missed','pending','started','pausedMs']) assert.deepEqual(saved[key], ctx[key]);
  assert.deepEqual(saved.settings, ctx.settingsSnapshot); assert.deepEqual(saved.retried, ['cvr:flash']);
  assert.equal(saved.remainingMs, resumeTiming.remainingMs); assert.equal(saved.interruptedAt, resumeTiming.interruptedAt);
  saved.missed[0].text = '変更'; saved.reviews[0].key = '変更'; saved.settings.rate = 0.7;
  assert.equal(ctx.missed[0].text, '成果の定義'); assert.equal(ctx.currentItem.key, 'cvr:q1'); assert.equal(ctx.settingsSnapshot.rate, 1.1);
});
test('JSON往復後に全キューと集計を復元する', () => {
  const saved = clone(VQ.buildResume(resumeContext(), resumeTiming));
  const restored = VQ.restoreSession(saved, [deckOf([card, makeCard('new')])]);
  for (const key of ['reviews','retries','fresh','tail','answered','correct','missed','pending','settings','started','pausedMs','remainingMs']) assert.deepEqual(restored[key], saved[key]);
  assert.deepEqual([...restored.retried], saved.retried);
});
test('復元は存在しないカードを全キューから除く', () => {
  const saved = VQ.buildResume(resumeContext(), resumeTiming), before = clone(saved);
  const restored = VQ.restoreSession(saved, []);
  for (const name of ['reviews','retries','fresh','tail']) assert.deepEqual(restored[name], []);
  assert.equal(restored.answered, 3); assert.equal(restored.correct, 2); assert.deepEqual(saved, before);
});
test('復元は削除または種類の変わった質問を除き、残りの順番を守る', () => {
  const saved = VQ.buildResume(resumeContext(), resumeTiming), changed = clone(card);
  changed.questions[1] = {type:'tf', statement:'更新', answer:true};
  saved.reviews.push({key:'cvr:q99', cardId:'cvr', mode:'tf', qIndex:99}, itemOf(card, 'tf'));
  const restored = VQ.restoreSession(saved, [deckOf([changed])]);
  assert.deepEqual(restored.reviews.map(item => item.key), ['cvr:reverse','cvr:q0']);
});
test('中断前と再開後の集計を合算し、元データは変更しない', () => {
  const before = VQ.buildResume(resumeContext(), resumeTiming), saved = clone(before);
  const after = {answered:2, correct:1, missed:[{term:'後半', text:'不足'}], pending:[]};
  const total = VQ.sessionTotals(before, after);
  assert.deepEqual(total, {answered:5, correct:3, missed:[...before.missed, ...after.missed], pending:before.pending});
  total.missed[0].text = '変更'; assert.deepEqual(before, saved);
});
test('再開後に再中断しても過去の集計を二重加算しない', () => {
  const first = VQ.buildResume(resumeContext(), resumeTiming);
  const ctx = VQ.restoreSession(first, [deckOf([card, makeCard('new')])]);
  Object.assign(ctx, VQ.sessionTotals(ctx, {answered:1, correct:1, missed:[], pending:[]}));
  ctx.settingsSnapshot = ctx.settings; ctx.currentItem = null;
  const second = VQ.buildResume(ctx, {...resumeTiming, remainingMs:100000});
  assert.equal(second.answered, 4); assert.equal(second.correct, 3); assert.deepEqual(second.pending, first.pending);
  assert.deepEqual(second.reviews, first.reviews); assert.deepEqual(second.retried, first.retried);
});
test('残り時間が0の中断データも復元する', () => {
  const saved = VQ.buildResume(resumeContext(), {...resumeTiming, remainingMs:0});
  assert.equal(VQ.restoreSession(saved, [deckOf([card])]).remainingMs, 0);
});
for (const [field, value] of [['answered',-1],['correct',4],['remainingMs',Infinity],['pausedMs',-1],['started','昨日'],['settings',null],['retried',['不正']],['reviews',{}],['missed',[{}]],['pending',[{}]]]) test(`不正な中断データを拒否する：${field}`, () => {
  const saved = VQ.buildResume(resumeContext(), resumeTiming); saved[field] = value;
  assert.throws(() => VQ.validateResume(saved));
});
test('不正なキュー項目の形式を拒否する', () => {
  const saved = VQ.buildResume(resumeContext(), resumeTiming); saved.reviews[0].qIndex = 99;
  assert.throws(() => VQ.validateResume(saved));
});

// ブラウザーの音声・保存・時刻だけを置き換え、実際のクリックとページイベントを通す。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
async function appHarness(initial = null) {
  let now = 0, nextTimer = 0, gesture = false, utterance = null, recognition = null, holdingWrites = false;
  const tasks = new Map(), nodes = new Map(), requests = [], speeches = [], writes = [], heldWrites = [];
  const storage = initial || {format:'voice-quiz-backup/v1', decks:[deckOf([card])],
    progress:{'cvr:reverse':progressOf(card, 'reverse', 1, '2020-01-01'), 'cvr:flash':progressOf(card, 'flash', 1, '2020-02-01'),
      '_card:cvr':{cardId:'cvr', recallStreak:0, screenedAt:today}}, pending:[], history:[], explanations:[],
    settings:{...VQ.DEFAULT_SETTINGS, cue:false}, builtinHashes:{}, resume:null};
  let stored = clone(storage);
  class Node {
    constructor() { this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.children = []; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    focus() {}
    setAttribute(name) { this[name] = true; }
    removeAttribute(name) { this[name] = false; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  for (const match of htmlSource.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const node = new Node(); node.hidden = /\bhidden\b/.test(match[0]); nodes.set(match[1], node);
  }
  const win = new Node(), doc = new Node();
  doc.visibilityState = 'visible'; doc.getElementById = id => { assert.ok(nodes.has(id), `未定義の要素：${id}`); return nodes.get(id); };
  doc.querySelectorAll = () => []; doc.createElement = () => new Node();
  win.VQ = VQ; win.scrollTo = () => {};
  win.setTimeout = (fn, ms) => { const id = ++nextTimer; tasks.set(id, {fn, at:now + Math.max(0, ms)}); return id; };
  win.clearTimeout = id => tasks.delete(id);
  const request = name => requests.push({name, gesture});
  win.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  win.speechSynthesis = {getVoices:() => [], addEventListener:() => {}, cancel:() => { utterance = null; },
    speak:value => { request('speech'); speeches.push(value.text); utterance = value; }};
  win.SpeechRecognition = class {
    constructor() { recognition = this; }
    start() { request('recognition'); if (this.onstart) this.onstart(); }
    stop() { if (this.onend) this.onend(); }
    abort() {}
  };
  win.AudioContext = class {
    constructor() { request('audio-context'); this.state = 'suspended'; }
    resume() { request('audio-resume'); this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; request('audio-suspend'); return Promise.resolve(); }
  };
  win.indexedDB = {open:() => {
    const result = {};
    queueMicrotask(() => {
      result.result = {transaction:() => {
        const transaction = {objectStore:() => ({
          get:() => { const read = {}; queueMicrotask(() => { read.result = clone(stored); read.onsuccess(); }); return read; },
          put:snapshot => {
            stored = clone(snapshot); writes.push(stored);
            if (holdingWrites) heldWrites.push(() => transaction.oncomplete());
            else queueMicrotask(() => transaction.oncomplete());
          }
        })};
        return transaction;
      }};
      result.onsuccess();
    });
    return result;
  }};
  const nav = {wakeLock:{request:() => {
    request('wake'); return Promise.resolve({released:false, release:() => { request('wake-release'); return Promise.resolve(); }, addEventListener:() => {}});
  }}};
  const context = {window:win, document:doc, navigator:nav, indexedDB:win.indexedDB,
    SpeechSynthesisUtterance:win.SpeechSynthesisUtterance, performance:{now:() => now}, console,
    fetch:async url => { assert.equal(url, 'decks/index.json'); return {ok:true, json:async () => []}; },
    Date:class extends Date { constructor(...args) { super(...(args.length ? args : [1794000000000 + now])); } static now() { return 1794000000000 + now; } }};
  vm.runInNewContext(appSource, context, {filename:'app.js'});
  await flush();
  async function advance(ms) {
    const target = now + ms;
    for (let i = 0; i < 1000; i++) {
      const due = [...tasks].filter(([,task]) => task.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!due) { now = target; await flush(); return; }
      tasks.delete(due[0]); now = due[1].at; due[1].fn(); await flush();
    }
    throw new Error('タイマーが収束しません');
  }
  return {nodes, requests, speeches, writes, advance, snapshot:() => clone(stored),
    holdWrites:() => { holdingWrites = true; },
    releaseWrites:async () => { holdingWrites = false; heldWrites.splice(0).forEach(complete => complete()); await flush(); },
    click:id => { gesture = true; nodes.get(id).dispatch('click'); gesture = false; },
    hide:() => { doc.visibilityState = 'hidden'; doc.dispatch('visibilitychange'); },
    show:() => { doc.visibilityState = 'visible'; doc.dispatch('visibilitychange'); },
    pagehide:() => win.dispatch('pagehide'),
    finishSpeech:async () => { assert.ok(utterance, '読み上げ待ち'); const value = utterance; utterance = null; value.onend(); await flush(); },
    respond:text => { const result = [{transcript:text, confidence:1}]; result.isFinal = true; recognition.onresult({resultIndex:0, results:[result]}); }
  };
}
async function testAsync(name, fn) {
  try { await fn(); passed++; }
  catch (error) { console.error(`失敗：${name}`); throw error; }
}
async function reachListening(app, resuming = false) {
  app.click(resuming ? 'resume' : 'start');
  await app.finishSpeech(); // アンロック
  await app.finishSpeech(); // 開始・再開案内
  await app.finishSpeech(); // 問題
  await app.finishSpeech(); // どうぞ
  await app.advance(300);
  assert.equal(app.nodes.get('listening-overlay').hidden, false);
}
async function integrationTests() {
  await testAsync('開始と再開はクリック同期内で認識・読み上げ・AudioContext・Wake Lockを要求する', async () => {
    const app = await appHarness(); app.click('start');
    for (const name of ['recognition','speech','audio-context','audio-resume','wake']) assert.ok(app.requests.some(item => item.name === name && item.gesture), name);
    app.hide(); await flush(); app.show(); app.requests.length = 0; app.click('resume');
    for (const name of ['recognition','speech','audio-resume','wake']) assert.ok(app.requests.some(item => item.name === name && item.gesture), name);
    await app.finishSpeech(); assert.equal(app.speeches.at(-1), '続きから再開します。');
  });
  await testAsync('回答中のhiddenとpagehideは履歴を作らず、未確定問題を先頭に保存する', async () => {
    const app = await appHarness(); await reachListening(app);
    app.hide(); app.pagehide(); await flush();
    const saved = app.snapshot(); assert.equal(saved.history.length, 0); assert.equal(saved.resume.answered, 0);
    assert.equal(saved.resume.reviews[0].key, 'cvr:reverse'); assert.equal(saved.progress['cvr:reverse'].correct, 0);
    assert.equal(app.nodes.get('page-home').hidden, false); assert.equal(app.nodes.get('resume-panel').hidden, false);
    assert.equal(app.nodes.get('resume-progress').textContent, '0問目まで進んでいます');
    assert.equal(app.nodes.get('listening-overlay').hidden, true); assert.equal(app.nodes.get('stop').hidden, true);
    assert.ok(app.requests.some(item => item.name === 'wake-release')); assert.ok(app.requests.some(item => item.name === 'audio-suspend'));
  });
  await testAsync('判定後に中断し、再読み込み後に再開して完走すると合計1回の履歴になる', async () => {
    const app = await appHarness(); await reachListening(app); app.respond('CVR'); await app.advance(1500);
    assert.ok(app.writes.some(saved => saved.progress['cvr:reverse'].correct === 1 && saved.resume.answered === 1));
    app.hide(); await flush(); const saved = app.snapshot();
    assert.equal(saved.resume.answered, 1); assert.equal(saved.resume.correct, 1); assert.equal(saved.resume.reviews.length, 0);
    const reopened = await appHarness(saved); assert.equal(reopened.nodes.get('resume-panel').hidden, false);
    reopened.click('resume'); await reopened.finishSpeech(); await reopened.finishSpeech();
    const finished = reopened.snapshot(); assert.equal(finished.history.length, 1); assert.equal(finished.history[0].total, 1); assert.equal(finished.history[0].correct, 1); assert.equal(finished.resume, null);
    reopened.hide(); await flush(); assert.equal(reopened.snapshot().resume, null); assert.equal(reopened.snapshot().history.length, 1);
  });
  await testAsync('停止ボタンは判定前の問題を加算せず結果画面を出し、連打でも一度だけ記録する', async () => {
    const app = await appHarness(); await reachListening(app); app.click('stop'); app.click('stop'); await flush();
    const saved = app.snapshot(); assert.equal(saved.resume, null); assert.equal(saved.history.length, 1);
    assert.equal(saved.history[0].total, 0); assert.equal(saved.history[0].reason, '途中終了（停止ボタン）');
    assert.equal(app.nodes.get('page-results').hidden, false);
  });
  await testAsync('判定の保存待ちに中断・再開しても同じ問題を戻さず、古い処理が集計を変えない', async () => {
    const app = await appHarness(); await reachListening(app); app.holdWrites(); app.respond('CVR'); await app.advance(1500);
    app.hide(); await flush(); app.click('export-backup');
    const saved = JSON.parse(app.nodes.get('backup-text').value);
    assert.equal(saved.resume.answered, 1); assert.equal(saved.resume.reviews.length, 0);
    app.show(); app.click('resume'); await app.finishSpeech(); await app.finishSpeech();
    await app.releaseWrites();
    assert.equal(app.snapshot().history.length, 1); assert.equal(app.snapshot().history[0].total, 1);
    assert.equal(app.snapshot().progress['cvr:reverse'].correct, 1); assert.equal(app.snapshot().resume, null);
  });
  await testAsync('説明の自己採点が終わる前の中断では、説明記録も段階も集計も保存しない', async () => {
    const initial = (await appHarness()).snapshot(); initial.decks[0].cards[0].keypoints = ['要点'];
    initial.progress['cvr:explain'] = progressOf(card, 'explain', 1, '2019-01-01');
    const app = await appHarness(initial); await reachListening(app); app.respond('説明しています'); await app.advance(3000);
    assert.ok(app.speeches.at(-1).includes('言えた、半分、言えなかった'));
    app.hide(); await flush(); const saved = app.snapshot();
    assert.equal(saved.explanations.length, 0); assert.equal(saved.resume.answered, 0); assert.equal(saved.resume.reviews[0].key, 'cvr:explain');
    assert.deepEqual(saved.progress['cvr:explain'], initial.progress['cvr:explain']);
  });
  await testAsync('再開後に回答・再中断・再開・停止しても全区間を合算した1回分を記録する', async () => {
    const initial = (await appHarness()).snapshot(); initial.resume = VQ.buildResume(resumeContext(), resumeTiming);
    initial.pending = clone(initial.resume.pending);
    const app = await appHarness(initial); await reachListening(app, true); app.respond('2'); await app.advance(1500);
    app.hide(); await flush();
    assert.equal(app.snapshot().history.length, 0); assert.equal(app.snapshot().resume.answered, 4); assert.equal(app.snapshot().resume.correct, 3);
    app.show(); app.click('resume'); app.click('stop'); await flush();
    const saved = app.snapshot(); assert.equal(saved.history.length, 1); assert.equal(saved.history[0].total, 4); assert.equal(saved.history[0].correct, 3);
    assert.deepEqual(saved.history[0].missed, initial.resume.missed); assert.deepEqual(saved.pending, initial.pending);
    assert.equal(saved.history[0].reason, '途中終了（停止ボタン）'); assert.equal(saved.resume, null);
  });
  await testAsync('中断分の終了はページ内確認のキャンセルで保持し、はいで1回だけ記録する', async () => {
    const app = await appHarness(); app.click('start'); app.hide(); await flush(); app.show();
    app.click('finish-resume'); assert.equal(app.nodes.get('confirm-resume').open, true);
    assert.equal(app.snapshot().history.length, 0); app.click('cancel-resume'); assert.ok(app.snapshot().resume);
    app.click('finish-resume'); app.click('confirm-resume-end'); app.click('confirm-resume-end'); await flush();
    assert.equal(app.snapshot().resume, null); assert.equal(app.snapshot().history.length, 1);
    assert.equal(app.snapshot().history[0].reason, '途中終了（中断のまま終了）'); assert.equal(app.nodes.get('page-results').hidden, false);
  });
  for (const button of ['start','start-weak']) await testAsync(`中断があれば新規開始は確認し、はいのクリック同期で開始する：${button}`, async () => {
    const app = await appHarness(); await reachListening(app); app.respond('別の答え'); await app.advance(1500);
    app.hide(); await flush(); app.show(); app.requests.length = 0;
    app.click(button); assert.equal(app.nodes.get('resume-confirm-heading').textContent, '中断した学習を終えて新しく始めますか');
    assert.equal(app.requests.length, 0); app.click('cancel-resume'); assert.ok(app.snapshot().resume);
    app.click(button); app.click('confirm-resume-end'); await flush();
    assert.equal(app.snapshot().history.length, 1); assert.equal(app.snapshot().history[0].total, 1);
    assert.ok(app.requests.some(item => item.name === 'recognition' && item.gesture));
  });
  await testAsync('再開後の時間制限は設定全体ではなく残り時間から進み、中断中は減らない', async () => {
    const app = await appHarness(); app.click('start'); await app.advance(1000); app.hide(); await flush();
    const saved = app.snapshot(); assert.equal(saved.resume.remainingMs, 599000);
    saved.resume.remainingMs = 2000;
    const reopened = await appHarness(saved); await reopened.advance(10000); reopened.click('resume'); await reopened.finishSpeech();
    await reopened.advance(1999); assert.equal(reopened.snapshot().history.length, 0);
    await reopened.advance(1); assert.equal(reopened.snapshot().history.length, 1); assert.equal(reopened.snapshot().history[0].reason, '設定した時間になりました。');
    assert.equal(reopened.snapshot().resume, null);
  });
  await testAsync('バックアップは中断を含めて検査し、不正な中断では置き換えない', async () => {
    const app = await appHarness(); app.click('start'); app.hide(); await flush();
    app.click('export-backup'); const exported = JSON.parse(app.nodes.get('backup-text').value); assert.ok(exported.resume);
    exported.resume.remainingMs = -1; app.nodes.get('backup-text').value = JSON.stringify(exported); app.click('load-backup');
    assert.ok(!app.nodes.get('confirm-backup').open); assert.ok(app.snapshot().resume);
    exported.resume.remainingMs = 1000; app.nodes.get('backup-text').value = JSON.stringify(exported); app.click('load-backup');
    assert.equal(app.nodes.get('confirm-backup').open, true); app.click('confirm-replace'); await flush();
    assert.equal(app.snapshot().resume.remainingMs, 1000);
    delete exported.resume; app.nodes.get('backup-text').value = JSON.stringify(exported); app.click('load-backup'); app.click('confirm-replace'); await flush();
    assert.equal(app.snapshot().resume, null); assert.equal(app.nodes.get('resume-panel').hidden, true);
  });
  console.log(`${passed}件のテストに成功しました。`);
}
void integrationTests().catch(error => { console.error(error); process.exitCode = 1; });
