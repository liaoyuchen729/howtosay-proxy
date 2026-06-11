// ===== 实测层:20 句覆盖各类语法,自动核查 4 项指标 =====
import { readFileSync } from 'fs';
// 接口密钥:环境变量优先,否则读仓库根目录的 .app-secret(gitignored)
let APP_KEY = process.env.APP_SHARED_SECRET || "";
try { if (!APP_KEY) APP_KEY = readFileSync(new URL('../.app-secret', import.meta.url), 'utf-8').trim(); } catch {}
const T = JSON.parse(readFileSync('templates.json'));
const TEMPLATE_NAMES = new Set(T.templates);

// —— 与服务端一致的匹配器(用于"泄漏"检查)——
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = new Set(["sb","sth","adj","adv","one","ving","ved","verb","noun","wh","etc","do","doing","done","x","y","n","v"]);
const IRR = {have:["have","has","had","having"],get:["get","gets","got","gotten","getting"],make:["make","makes","made","making"],take:["take","takes","took","taken","taking"],keep:["keep","keeps","kept","keeping"],go:["go","goes","went","gone","going"],come:["come","comes","came","coming"],feel:["feel","feels","felt","feeling"],think:["think","thinks","thought","thinking"],say:["say","says","said","saying"],see:["see","sees","saw","seen","seeing"],know:["know","knows","knew","known","knowing"],let:["let","lets","letting"],find:["find","finds","found","finding"],give:["give","gives","gave","given","giving"],tell:["tell","tells","told","telling"],leave:["leave","leaves","left","leaving"],pay:["pay","pays","paid","paying"],spend:["spend","spends","spent","spending"],lose:["lose","loses","lost","losing"],catch:["catch","catches","caught","catching"],put:["put","puts","putting"],run:["run","runs","ran","running"],cut:["cut","cuts","cutting"],begin:["begin","begins","began","begun"],write:["write","writes","wrote","written"],bring:["bring","brings","brought","bringing"],buy:["buy","buys","bought","buying"],hold:["hold","holds","held","holding"],stand:["stand","stands","stood","standing"]};
const ALT = {"can't":["can't","cannot","can not"],"won't":["won't","will not"],"i'd":["i'd","i would","i had"],"you'd":["you'd","you would","you had"],"it's":["it's","it is","it has"],"i'm":["i'm","i am"],"would've":["would've","would have"],"one's":["one's","his","her","my","your","our","their","its"]};
function matcher(translation) {
  const runs = (seg) => { const rs=[]; let cur=[]; const re=/[A-Za-z']+/g; let m,le=-1;
    while((m=re.exec(seg))!==null){const tok=m[0];const adj=le>=0&&/^\s*$/.test(seg.slice(le,m.index));
      if(PLACEHOLDER.has(tok.toLowerCase())){if(cur.length){rs.push(cur);cur=[];}}
      else if(adj&&cur.length)cur.push(tok);else{if(cur.length)rs.push(cur);cur=[tok];}le=m.index+tok.length;}
    if(cur.length)rs.push(cur);return rs;};
  const tp=(t)=>{const tl=t.toLowerCase();
    if(tl==="be")return "(?:be|is|am|are|was|were|been|being)";
    if(IRR[tl])return `(?:${IRR[tl].join("|")})`;
    if(ALT[tl])return `(?:${ALT[tl].map(a=>escapeRe(a).replace(/ /g,"\\s+")).join("|")})`;
    if(tl.endsWith("n't")){const s=tl.slice(0,-3);return `(?:${escapeRe(tl)}|${escapeRe(s)}\\s+not)`;}
    return escapeRe(t)+"(?:s|es|d|ed|ing)?";};
  const pin=(run)=>new RegExp(`(^|[^A-Za-z])${run.map(tp).join("\\s+")}([^A-Za-z]|$)`,"i").test(translation);
  return (name)=>{const alts=String(name).split(/\/|(?:^|\s)vs(?:\s|$)/i).map(runs);
    if(!alts.some(a=>a.length>0))return true;
    return alts.some(a=>a.length>0&&a.every(pin));};
}

// —— 20 个语法概念 × 9 种语言的原生句子 ——
// 用法: node tools/live_battery.mjs           → 只跑简体中文
//       node tools/live_battery.mjs --lang=ja → 跑指定语言
//       node tools/live_battery.mjs --all     → 9 语言全跑(180 句)
const CONCEPTS = [
  ["被动","passive","written"], ["used to"], ["too"], ["so","that","too","catch up"],
  ["prefer","比"], ["rather"], ["had better","你最好"], ["not only","关联连词"],
  ["as soon as","一...就"], ["if","虚拟","条件"], ["take care","照顾","took care"],
  ["make up","决心","decide"], ["can't help","忍不住"], ["worth"], ["give up","quit","戒"],
  ["if only","wish","但愿"], ["越来越","比较级 and"], ["as if","seem","look"],
  ["used to","习惯","be used to"], ["感叹","What","How"],
];
const SENTENCES = {
  "Simplified Chinese": ["这本书是他写的。","我过去常常每天跑步。","这个箱子太重了我搬不动。","他跑得太快了,我们都追不上他。","比起咖啡我更喜欢茶。","我宁愿走路也不愿坐公交。","你最好早点睡觉。","他不仅会唱歌还会跳舞。","我一到家就给你打电话。","如果我是你,我就不会去。","她昨天照顾了她生病的妹妹。","他终于下定决心出国留学了。","我忍不住笑了出来。","这部电影值得一看。","他去年戒烟了。","要是我有更多时间就好了!","天气越来越冷了。","他看起来好像生病了。","我习惯了早起。","多漂亮的花啊!"],
  "Traditional Chinese": ["這本書是他寫的。","我過去常常每天跑步。","這個箱子太重了我搬不動。","他跑得太快了,我們都追不上他。","比起咖啡我更喜歡茶。","我寧願走路也不願坐公車。","你最好早點睡覺。","他不僅會唱歌還會跳舞。","我一到家就給你打電話。","如果我是你,我就不會去。","她昨天照顧了她生病的妹妹。","他終於下定決心出國留學了。","我忍不住笑了出來。","這部電影值得一看。","他去年戒菸了。","要是我有更多時間就好了!","天氣越來越冷了。","他看起來好像生病了。","我習慣了早起。","多漂亮的花啊!"],
  "Japanese": ["この本は彼によって書かれました。","私は昔、毎日走っていました。","この箱は重すぎて私には運べません。","彼は走るのが速すぎて、誰も追いつけません。","コーヒーより紅茶のほうが好きです。","バスに乗るくらいなら歩くほうがましです。","早く寝たほうがいいですよ。","彼は歌だけでなくダンスもできます。","家に着いたらすぐ電話します。","もし私があなたなら、行きません。","彼女は昨日、病気の妹の世話をしました。","彼はついに留学する決心をしました。","思わず笑ってしまいました。","この映画は見る価値があります。","彼は去年タバコをやめました。","もっと時間があればいいのに!","天気がますます寒くなってきました。","彼は病気のように見えます。","私は早起きに慣れています。","なんてきれいな花でしょう!"],
  "Korean": ["이 책은 그가 쓴 것입니다.","나는 예전에 매일 달리기를 했어요.","이 상자는 너무 무거워서 나는 들 수 없어요.","그는 너무 빨리 달려서 아무도 따라잡을 수 없어요.","커피보다 차를 더 좋아해요.","버스를 타느니 차라리 걷겠어요.","일찍 자는 게 좋겠어요.","그는 노래뿐만 아니라 춤도 출 수 있어요.","집에 도착하자마자 전화할게요.","내가 너라면 안 갈 거야.","그녀는 어제 아픈 여동생을 돌봤어요.","그는 마침내 유학을 가기로 결심했어요.","나도 모르게 웃음이 터졌어요.","이 영화는 볼 만한 가치가 있어요.","그는 작년에 담배를 끊었어요.","시간이 더 있으면 좋을 텐데!","날씨가 점점 더 추워지고 있어요.","그는 아픈 것처럼 보여요.","나는 일찍 일어나는 것에 익숙해요.","정말 아름다운 꽃이네요!"],
  "Spanish": ["Este libro fue escrito por él.","Antes yo corría todos los días.","Esta caja es demasiado pesada para que yo la mueva.","Corre tan rápido que nadie puede alcanzarlo.","Prefiero el té al café.","Prefiero caminar antes que tomar el autobús.","Será mejor que te acuestes temprano.","No solo sabe cantar, sino también bailar.","Te llamaré en cuanto llegue a casa.","Si yo fuera tú, no iría.","Ayer ella cuidó a su hermana enferma.","Por fin se decidió a estudiar en el extranjero.","No pude evitar reírme.","Esta película vale la pena verla.","Dejó de fumar el año pasado.","¡Ojalá tuviera más tiempo!","El clima está cada vez más frío.","Parece que está enfermo.","Estoy acostumbrado a levantarme temprano.","¡Qué flores tan hermosas!"],
  "Portuguese": ["Este livro foi escrito por ele.","Eu costumava correr todos os dias.","Esta caixa é pesada demais para eu carregar.","Ele corre rápido demais, ninguém consegue alcançá-lo.","Prefiro chá a café.","Prefiro andar a pegar o ônibus.","É melhor você dormir cedo.","Ele não só canta, mas também dança.","Vou te ligar assim que chegar em casa.","Se eu fosse você, não iria.","Ontem ela cuidou da irmã doente.","Ele finalmente decidiu estudar no exterior.","Não consegui deixar de rir.","Este filme vale a pena assistir.","Ele parou de fumar no ano passado.","Quem dera eu tivesse mais tempo!","O tempo está ficando cada vez mais frio.","Ele parece estar doente.","Estou acostumado a acordar cedo.","Que flores lindas!"],
  "Hindi": ["यह किताब उसके द्वारा लिखी गई थी।","मैं पहले हर रोज़ दौड़ता था।","यह बक्सा इतना भारी है कि मैं उठा नहीं सकता।","वह इतनी तेज़ दौड़ता है कि कोई उसे पकड़ नहीं सकता।","मुझे कॉफ़ी से ज़्यादा चाय पसंद है।","मैं बस लेने के बजाय पैदल चलना पसंद करूँगा।","तुम्हें जल्दी सो जाना चाहिए।","वह न केवल गा सकता है बल्कि नाच भी सकता है।","घर पहुँचते ही मैं तुम्हें फ़ोन करूँगा।","अगर मैं तुम्हारी जगह होता, तो नहीं जाता।","कल उसने अपनी बीमार बहन की देखभाल की।","आख़िरकार उसने विदेश में पढ़ने का फ़ैसला कर लिया।","मैं हँसे बिना नहीं रह सका।","यह फ़िल्म देखने लायक है।","उसने पिछले साल सिगरेट छोड़ दी।","काश मेरे पास और समय होता!","मौसम और ठंडा होता जा रहा है।","ऐसा लगता है कि वह बीमार है।","मुझे जल्दी उठने की आदत है।","कितने सुंदर फूल हैं!"],
  "Vietnamese": ["Cuốn sách này do anh ấy viết.","Trước đây tôi thường chạy bộ mỗi ngày.","Cái hộp này quá nặng, tôi không bê nổi.","Anh ấy chạy nhanh quá, không ai đuổi kịp.","Tôi thích trà hơn cà phê.","Tôi thà đi bộ còn hơn đi xe buýt.","Bạn nên đi ngủ sớm thì hơn.","Anh ấy không những biết hát mà còn biết nhảy.","Vừa về đến nhà tôi sẽ gọi cho bạn ngay.","Nếu tôi là bạn, tôi sẽ không đi.","Hôm qua cô ấy đã chăm sóc em gái bị ốm.","Cuối cùng anh ấy đã quyết tâm đi du học.","Tôi không nhịn được cười.","Bộ phim này đáng xem.","Anh ấy đã bỏ thuốc lá năm ngoái.","Giá mà tôi có nhiều thời gian hơn!","Thời tiết ngày càng lạnh hơn.","Trông anh ấy như bị ốm.","Tôi đã quen dậy sớm.","Hoa đẹp quá!"],
  "Indonesian": ["Buku ini ditulis olehnya.","Dulu saya biasa berlari setiap hari.","Kotak ini terlalu berat untuk saya angkat.","Dia berlari terlalu cepat, tidak ada yang bisa mengejarnya.","Saya lebih suka teh daripada kopi.","Saya lebih baik jalan kaki daripada naik bus.","Sebaiknya kamu tidur lebih awal.","Dia tidak hanya bisa menyanyi tetapi juga menari.","Begitu sampai di rumah, saya akan meneleponmu.","Kalau saya jadi kamu, saya tidak akan pergi.","Kemarin dia merawat adiknya yang sakit.","Akhirnya dia memutuskan untuk belajar di luar negeri.","Saya tidak bisa menahan tawa.","Film ini layak ditonton.","Dia berhenti merokok tahun lalu.","Andai saja saya punya lebih banyak waktu!","Cuacanya semakin dingin.","Dia kelihatan seperti sedang sakit.","Saya terbiasa bangun pagi.","Bunga yang indah sekali!"],
};
const argLang = process.argv.find(a => a.startsWith("--lang="))?.slice(7);
const runAll = process.argv.includes("--all");
const LANG_MAP = { zh:"Simplified Chinese", zh_Hant:"Traditional Chinese", ja:"Japanese", ko:"Korean", es:"Spanish", pt:"Portuguese", hi:"Hindi", vi:"Vietnamese", id:"Indonesian" };
const langsToRun = runAll ? Object.values(LANG_MAP)
  : [LANG_MAP[argLang] || "Simplified Chinese"];
const CASES = langsToRun.flatMap(lang =>
  SENTENCES[lang].map((src, i) => [src, CONCEPTS[i], lang]));


// 检测器注入白名单:服务端有意做宽匹配的结构(couldn't help → can't help 模板等),
// 泄漏检查时跳过 —— 与 server.js 的 STRUCTURE_DETECTORS 保持同步
const DETECTOR_OK = [
  { re: /\bnot only\b[\s\S]{0,80}?\bbut(\s+also)?\b/i, tpl: "关联连词(either...or / neither...nor / not only...but also)" },
  { re: /\b(am|is|are|was|were|been|being|get|gets|got|getting)\s+used\s+to\b/i, tpl: "used to do vs be used to doing" },
  { re: /\b(can't|cannot|can not|couldn't|could not)\s+help\b/i, tpl: "can't help doing(忍不住)" },
  { re: /\bso\s+[A-Za-z]+\s+that\b/i, tpl: "so + 形容词 + that 从句" },
  { re: /\btoo\s+[A-Za-z]+\s+(for\s+[A-Za-z]+\s+)?to\s+[A-Za-z]+/i, tpl: "too + 形容词 + to do" },
  { re: /\b(am|is|are|was|were)\s+worth\s+[A-Za-z]+ing\b/i, tpl: "it's worth + doing(值得做)" },
];
const fails = { leak: [], trigger: [], chunk: [], spanShare: [], intensifier: [], funcWord: [] };
const INTENSIFIERS = new Set(["really","actually","truly","just","simply","definitely","certainly"]);
const ADV_OK = ["本当に","ほんとうに","ほんとに","本当","実際","実は","マジ","真的","真","确实","確實","其实","其實","的确","的確","實在","实在","정말","정말로","진짜","사실","실제로","realmente","de verdad","en realidad","de hecho","mesmo","de fato","सच में","सचमुच","वाक़ई","असल में","thật","thực sự","thật sự","quả thật","benar-benar","sungguh","memang","sebenarnya"];
const FUNC_WORDS = new Set(["i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","am","is","are","was","were","a","an","the","i'm","it's","'s","'re","'m"]);
let conceptHits = 0, total = 0;
for (const [src, concepts, srcLang] of CASES) {
  total++;
  let r;
  try {
    const resp = await fetch("https://howtosay-proxy-production.up.railway.app/translate", {
      method: "POST", headers: {"Content-Type":"application/json", ...(APP_KEY ? {"X-App-Key": APP_KEY} : {})},
      body: JSON.stringify({sourceText: src, style: "standard", sourceLanguage: srcLang}),
      signal: AbortSignal.timeout(70000)
    });
    r = await resp.json();
  } catch(e) { console.log("✗ 请求失败:", src, String(e).slice(0,80)); continue; }
  if (!r.translation) { console.log("✗ 无译文:", src, JSON.stringify(r).slice(0,100)); continue; }
  const tl = r.translation;
  const check = matcher(tl);
  const gp = r.grammarPoints || [];
  // A. 泄漏:模板点的名字必须匹配译文
  for (const g of gp) {
    const detectorOK = DETECTOR_OK.some(d => d.tpl === g.name && d.re.test(tl));
    if (g.isTemplate && TEMPLATE_NAMES.has(g.name) && !check(g.name) && !detectorOK) {
      fails.leak.push(`[${src}] ${g.name} ⊄ "${tl}"`);
    }
    // B. 触发词必须在译文里
    for (const t of (g.triggerWords||[])) {
      if (!new RegExp(`(^|[^A-Za-z])${escapeRe(t.trim())}([^A-Za-z]|$)`,"i").test(tl)) {
        fails.trigger.push(`[${src}] trigger "${t}" ∉ 译文`);
      }
    }
  }
  // C. 语法块覆盖
  const norm = s => s.trim().toLowerCase();
  for (const w of (r.words||[])) {
    if (!w.isGrammarStructure) continue;
    const ct = norm(w.english).split(/\s+/);
    const covered = gp.some(g => { const tr=(g.triggerWords||[]).map(norm);
      return tr.includes(norm(w.english)) || ct.every(x=>tr.includes(x)); });
    if (!covered) fails.chunk.push(`[${src}] 块 "${w.english}" 无详解条目`);
  }
  // D. 同 span 超额认领(原文出现次数不够分)
  {
    const counts = new Map();
    for (const w of (r.words||[])) if (w.sourceSpan) counts.set(w.sourceSpan, (counts.get(w.sourceSpan)||0)+1);
    for (const [sp, n] of counts) {
      if (n < 2) continue;
      let occ = 0, p = 0;
      while ((p = src.indexOf(sp, p)) !== -1) { occ++; p += sp.length; }
      if (n > occ) fails.spanShare.push(`[${src}] "${sp}" 被认领${n}次但只出现${occ}次`);
    }
  }
  // E. 添加的强调副词错配(span 不是真副词)
  for (const w of (r.words||[])) {
    if (!w.sourceSpan || !INTENSIFIERS.has((w.english||"").trim().toLowerCase())) continue;
    if (!ADV_OK.some(a => w.sourceSpan.includes(a) || a.includes(w.sourceSpan)))
      fails.intensifier.push(`[${src}] ${w.english}=${w.sourceSpan}`);
  }
  // F. 功能词带色(代词/be/冠词不应有对齐)
  for (const w of (r.words||[])) {
    if (w.sourceSpan && FUNC_WORDS.has((w.english||"").trim().toLowerCase()))
      fails.funcWord.push(`[${src}] ${w.english}=${w.sourceSpan}`);
  }
  // D. 软指标:期望概念命中
  const names = gp.map(g=>g.name).join(" | ");
  const hit = concepts.some(c => names.toLowerCase().includes(c.toLowerCase()) || (c.length<=12 && tl.toLowerCase().includes(c.toLowerCase()) && false));
  if (hit) conceptHits++;
  console.log((hit?"○":"·"), `[${srcLang.slice(0,4)}]`, src.slice(0,18), "→", tl.slice(0,50), "|| GP:", names || "(无)");
}
console.log("\n========== 汇总 ==========");
console.log("硬指标 A 校验泄漏:", fails.leak.length, fails.leak.slice(0,5));
console.log("硬指标 B 触发词缺失:", fails.trigger.length, fails.trigger.slice(0,5));
console.log("硬指标 C 语法块未覆盖:", fails.chunk.length, fails.chunk.slice(0,5));
console.log("硬指标 D 同span超额认领:", fails.spanShare.length, fails.spanShare.slice(0,3));
console.log("硬指标 E 强调副词错配:", fails.intensifier.length, fails.intensifier.slice(0,3));
console.log("硬指标 F 功能词带色:", fails.funcWord.length, fails.funcWord.slice(0,3));
console.log(`软指标 识别率: ${conceptHits}/${total}`);
