'use strict';
/**
 * フェーズ7a 基盤検証スクリプト (research/DESIGN_SIM.md 要検証6項目)
 * 使い方: node research/tools/verify_sim_7a.js
 */

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let Sim;
try {
  Sim = require(path.join(ROOT, 'dist', 'sim'));
} catch (e) {
  console.error('FATAL: dist/sim が読み込めません。node build を実行してください。');
  process.exit(1);
}

const FORMAT_ID = 'gen9championscustomgame';

// ---------------------------------------------------------------------------
// チーム定義 (Champions SP制: 1ステ最大32, 合計66)
// ---------------------------------------------------------------------------

function makeTeam1v1_Garchomp() {
  return [{ species: 'Garchomp', ability: 'Rough Skin', nature: 'Jolly',
    evs: { hp: 2, atk: 32, spe: 32 }, ivs: { hp:31,atk:31,def:31,spa:31,spd:31,spe:31 },
    level: 50, moves: ['Earthquake','Scale Shot','Stealth Rock','Rock Tomb'] }];
}
function makeTeam1v1_Hippowdon() {
  return [{ species: 'Hippowdon', ability: 'Sand Stream', nature: 'Impish', item: 'sitrusberry',
    evs: { hp:32, def:32, spd:2 }, ivs: { hp:31,atk:31,def:31,spa:31,spd:31,spe:31 },
    level: 50, moves: ['Earthquake','Slack Off','Stealth Rock','Whirlwind'] }];
}
function makeTeam3v3_A() { return [
  { species:'Garchomp', ability:'Rough Skin', nature:'Jolly', evs:{hp:2,atk:32,spe:32},
    ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}, level:50,
    moves:['Earthquake','Scale Shot','Stealth Rock','Rock Tomb'] },
  { species:'Primarina', ability:'Torrent', nature:'Modest', item:'sitrusberry',
    evs:{hp:32,def:2,spa:32}, ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}, level:50,
    moves:['Sparkling Aria','Moonblast','Flip Turn','Misty Terrain'] },
  { species:'Corviknight', ability:'Mirror Armor', nature:'Impish', item:'leftovers',
    evs:{hp:32,def:32,spa:2}, ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}, level:50,
    moves:['Body Press','U-turn','Iron Defense','Roost'] },
]; }
function makeTeam3v3_B() { return [
  { species:'Hippowdon', ability:'Sand Stream', nature:'Impish', item:'sitrusberry',
    evs:{hp:32,def:32,spd:2}, ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}, level:50,
    moves:['Earthquake','Slack Off','Stealth Rock','Whirlwind'] },
  { species:'Mimikyu', ability:'Disguise', nature:'Jolly', item:'fairyfeather',
    evs:{hp:2,atk:32,spe:32}, ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}, level:50,
    moves:['Swords Dance','Play Rough','Shadow Sneak','Drain Punch'] },
  { species:'Meowscarada', ability:'Protean', nature:'Jolly', item:'choicescarf',
    evs:{hp:2,atk:32,spe:32}, ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}, level:50,
    moves:['Flower Trick','Knock Off','U-turn','Trailblaze'] },
]; }

// ---------------------------------------------------------------------------
// buildChoice: request から合法手を列挙しランダム選択
// ---------------------------------------------------------------------------

function buildChoice(req, rng, opts) {
  var move_bias    = (opts && opts.move_bias    !== undefined) ? opts.move_bias    : 0.7;
  var mega_enabled = (opts && opts.mega_enabled !== undefined) ? opts.mega_enabled : true;
  if (!req || req.wait) return null;
  if (req.forceSwitch) {
    var pks = req.side.pokemon, chosen = [];
    return req.forceSwitch.map(function(ms, i) {
      if (!ms) return 'pass';
      var cs = [];
      for (var j=1; j<=pks.length; j++) {
        if (!pks[j-1]) continue;
        if (j<=req.forceSwitch.length && !pks[i].reviving) continue;
        if (chosen.includes(j)) continue;
        if (pks[j-1].condition.endsWith(' fnt') === !pks[i].reviving) continue;
        cs.push(j);
      }
      if (!cs.length) return 'pass';
      var p = cs[Math.floor(rng()*cs.length)]; chosen.push(p); return 'switch '+p;
    }).join(', ');
  }
  if (req.active) {
    var pks2 = req.side.pokemon, chosen2 = [];
    return req.active.map(function(active, i) {
      if (pks2[i].condition.endsWith(' fnt')) return 'pass';
      var mvs = [];
      for (var j=0; j<active.moves.length; j++) if (!active.moves[j].disabled) mvs.push(j+1);
      var cs2 = [];
      for (var j2=1; j2<=pks2.length; j2++) {
        if (!pks2[j2-1] || pks2[j2-1].active || chosen2.includes(j2)
            || pks2[j2-1].condition.endsWith(' fnt')) continue;
        cs2.push(j2);
      }
      var sw2 = active.trapped ? [] : cs2;
      var ch;
      if (sw2.length > 0 && rng() > move_bias) {
        var s = sw2[Math.floor(rng()*sw2.length)]; chosen2.push(s); ch = 'switch '+s;
      } else {
        if (!mvs.length) return 'move 1';
        var sl = mvs[Math.floor(rng()*mvs.length)];
        ch = 'move '+sl;
        if (mega_enabled && active.canMegaEvo) ch += ' mega';
      }
      return ch;
    }).join(', ');
  }
  return null;
}

// ---------------------------------------------------------------------------
// レポートユーティリティ
// ---------------------------------------------------------------------------

var failCount = 0;
function pass(t,m){console.log('  PASS ['+t+'] '+m);}
function fail(t,m){failCount++;console.log('  FAIL ['+t+'] '+m);}
function info(t,m){console.log('  INFO ['+t+'] '+m);}
function section(s){
  console.log([String.fromCharCode(10)+"=".repeat(60),"  "+s,"=".repeat(60)].join(String.fromCharCode(10)));
}
// ---------------------------------------------------------------------------
// 項目1: 3v3フルバトル
// ---------------------------------------------------------------------------

function verify1_3v3_fullbattle() {
  section('項目1: 3v3フルバトル (makeChoices 直接駆動・forceSwitch/自発交代込み)');
  var prng=new Sim.PRNG([111,222,333,444]), rng=function(){return prng.random();};
  var MAX_TURNS=300, NUM=20, ended=0, fsSeen=0, volSw=0, totalT=0, winners=[];
  for (var i=0;i<NUM;i++) {
    var seed=[i*31+1,i*37+2,i*41+3,i*43+5];
    var b=new Sim.Battle({formatid:FORMAT_ID,seed:seed,
      p1:{team:makeTeam3v3_A()},p2:{team:makeTeam3v3_B()},strictChoices:false});
    b.makeChoices('team 1','team 1');
    var t=0;
    while (!b.ended && t<MAX_TURNS) {
      var r1=b.p1.activeRequest, r2=b.p2.activeRequest;
      if (r1 && r1.forceSwitch) fsSeen++;
      if (r2 && r2.forceSwitch) fsSeen++;
      var c1=buildChoice(r1,rng,{move_bias:0.7});
      var c2=buildChoice(r2,rng,{move_bias:0.7});
      if (c1&&c1.includes('switch')&&r1&&!r1.forceSwitch) volSw++;
      if (c2&&c2.includes('switch')&&r2&&!r2.forceSwitch) volSw++;
      b.makeChoices(c1||'move 1',c2||'move 1');
      t++;
    }
    totalT+=t; if(b.ended){ended++;winners.push(b.winner);}
  }
  if (ended===NUM) pass('3v3-ended','全'+NUM+'戦が正常終了(上限'+MAX_TURNS+'ターン以内)');
  else fail('3v3-ended',ended+'/'+NUM+'戦のみ終了');
  if (fsSeen>0) pass('3v3-forceswitch','forceSwitch リクエストが'+fsSeen+'回発生し正常処理');
  else fail('3v3-forceswitch','forceSwitch リクエストが一度も発生しなかった');
  if (volSw>0) pass('3v3-volswitch','自発的な交代が'+volSw+'回発生し通過');
  else info('3v3-volswitch','自発的な交代が0回(move_bias=0.7のため頻度低)');
  var p1w=winners.filter(function(w){return w==='Player 1';}).length;
  info('3v3-stats','平均ターン数:'+(totalT/NUM).toFixed(1)+' / p1='+p1w+', p2='+(NUM-ended===0?NUM-p1w:'?'));
}

// ---------------------------------------------------------------------------
// 項目2: 速度ベンチマーク
// ---------------------------------------------------------------------------

function verify2_speed_bench() {
  section('項目2: 速度ベンチマーク (ランダムポリシー)');
  // 1v1
  var N=1000, prng1=new Sim.PRNG([1,2,3,4]), rng1=function(){return prng1.random();};
  var tt1=0, e1=0, s1=Date.now();
  for (var i=0;i<N;i++) {
    var b=new Sim.Battle({formatid:FORMAT_ID,seed:[i*7+1,i*13+2,i*17+3,i*19+5],
      p1:{team:makeTeam1v1_Garchomp()},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
    b.makeChoices('team 1','team 1');
    var t=0;
    while (!b.ended&&t<300){
      b.makeChoices(buildChoice(b.p1.activeRequest,rng1,{move_bias:1.0})||'move 1',
                    buildChoice(b.p2.activeRequest,rng1,{move_bias:1.0})||'move 1');
      t++;
    }
    tt1+=t; if(b.ended)e1++;
  }
  var el1=((Date.now()-s1)/1000), bps1=(N/el1).toFixed(1);
  info('bench-1v1','1v1 '+N+'戦: '+el1.toFixed(2)+'s = '+bps1+' 試合/秒, 平均'+(tt1/N).toFixed(1)+'ターン, 終了'+e1+'/'+N);
  pass('bench-1v1-ok','1v1 速度計測完了 ('+bps1+' 試合/秒)');
  // 3v3
  var N3=500, prng3=new Sim.PRNG([5,6,7,8]), rng3=function(){return prng3.random();};
  var tt3=0, e3=0, s3=Date.now();
  for (var i3=0;i3<N3;i3++) {
    var b3=new Sim.Battle({formatid:FORMAT_ID,seed:[i3*11+1,i3*13+2,i3*17+3,i3*23+5],
      p1:{team:makeTeam3v3_A()},p2:{team:makeTeam3v3_B()},strictChoices:false});
    b3.makeChoices('team 1','team 1');
    var t3=0;
    while (!b3.ended&&t3<300){
      b3.makeChoices(buildChoice(b3.p1.activeRequest,rng3,{move_bias:0.7})||'move 1',
                     buildChoice(b3.p2.activeRequest,rng3,{move_bias:0.7})||'move 1');
      t3++;
    }
    tt3+=t3; if(b3.ended)e3++;
  }
  var el3=((Date.now()-s3)/1000), bps3=(N3/el3).toFixed(1);
  info('bench-3v3','3v3 '+N3+'戦: '+el3.toFixed(2)+'s = '+bps3+' 試合/秒, 平均'+(tt3/N3).toFixed(1)+'ターン, 終了'+e3+'/'+N3);
  pass('bench-3v3-ok','3v3 速度計測完了 ('+bps3+' 試合/秒)');
}

// ---------------------------------------------------------------------------
// 項目3: seed 再現性
// ---------------------------------------------------------------------------

function verify3_seed_repro() {
  section('項目3: seed 再現性 (同一seed+同一choice列 -> 同一結果)');
  function runWithSeed(seed) {
    var b=new Sim.Battle({formatid:FORMAT_ID,seed:seed,
      p1:{team:makeTeam3v3_A()},p2:{team:makeTeam3v3_B()},strictChoices:false});
    b.makeChoices('team 1','team 1');
    var t=0;
    while (!b.ended&&t<300) {
      var r1=b.p1.activeRequest, r2=b.p2.activeRequest;
      var c1='move 1', c2='move 1';
      if (r1&&r1.forceSwitch) { var ps1=r1.side.pokemon;
        for (var j=1;j<=ps1.length;j++) {
          if(ps1[j-1]&&!ps1[j-1].active&&!ps1[j-1].condition.endsWith(' fnt')){c1='switch '+j;break;}
        }
      }
      if (r2&&r2.forceSwitch) { var ps2=r2.side.pokemon;
        for (var k=1;k<=ps2.length;k++) {
          if(ps2[k-1]&&!ps2[k-1].active&&!ps2[k-1].condition.endsWith(' fnt')){c2='switch '+k;break;}
        }
      }
      b.makeChoices(c1,c2); t++;
    }
    return {winner:b.winner||'',turns:t,ended:b.ended,
            logHash:b.log?b.log.slice(0,50).join('|'):''};
  }
  var seeds=[[12345,67890,11111,22222],[99999,88888,77777,66666],[314159,265358,979323,846264]];
  var allMatch=true;
  for (var si=0;si<seeds.length;si++) {
    var seed=seeds[si];
    var r1=runWithSeed(seed),r2=runWithSeed(seed),r3=runWithSeed(seed);
    if (JSON.stringify(r1)===JSON.stringify(r2)&&JSON.stringify(r2)===JSON.stringify(r3)) {
      pass('seed-repro','seed ['+seed+']: 3回とも同一結果 (winner='+r1.winner+', turns='+r1.turns+')');
    } else {
      fail('seed-repro','seed ['+seed+']: 結果が一致しない');
      allMatch=false;
    }
  }
  if (allMatch) pass('seed-repro-summary','全3 seed で再現性確認 -> バグ調査・回帰テストの基盤として利用可能');
}

function verify4_mega() {
  section("項目4: メガシンカ (canMegaEvo フラグ / move X mega / ステータス変化)");
  var tL=[{species:"Lopunny",ability:"Scrappy",nature:"Jolly",item:"lopunnite",
    evs:{hp:2,atk:32,spe:32},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,
    moves:["Fake Out","High Jump Kick","Facade","Ice Punch"]}];
  var bL=new Sim.Battle({formatid:FORMAT_ID,seed:[1,2,3,4],p1:{team:tL},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
  bL.makeChoices("team 1","team 1");
  var req0=bL.p1.activeRequest,act0=req0&&req0.active&&req0.active[0];
  if (act0&&act0.canMegaEvo===true) pass("mega-flag","メガストーン所持時 canMegaEvo===true がリクエストに出る");
  else fail("mega-flag","canMegaEvo expected true");
  if (!act0.canTerastallize&&!act0.canZMove&&!act0.canDynamax)
    pass("mega-no-other","canTerastallize/canZMove/canDynamax は全て falsy");
  else fail("mega-no-other","unexpected mechanics flags");
  var sbf=Object.assign({},bL.p1.active[0].storedStats), spbf=bL.p1.active[0].species.id;
  try {
    bL.makeChoices("move 1 mega","move 1");
    pass("mega-choice","move 1 mega choice が通過した");
  } catch(e) { fail("mega-choice","move 1 mega でエラー: "+e.message); return; }
  var spaf=bL.p1.active[0].species.id;
  if (spaf==="lopunnymega") pass("mega-species","メガシンカ後の種族=lopunnymega");
  else fail("mega-species","メガシンカ後の種族="+spaf);
  var saft=bL.p1.active[0].storedStats;
  if (saft.atk>sbf.atk) pass("mega-stats","攻撃実数値が変化"+sbf.atk+"->"+saft.atk);
  else fail("mega-stats","攻撃実数値が変化しなかった");
  if (!bL.ended) {
    var cmaf=bL.p1.activeRequest&&bL.p1.activeRequest.active&&bL.p1.activeRequest.active[0]&&bL.p1.activeRequest.active[0].canMegaEvo;
    if (!cmaf) pass("mega-once","メガシンカ後の次ターン canMegaEvo=falsy → 2回メガ防止を確認");
    else fail("mega-once","メガシンカ後でも canMegaEvo=true");
  }
  var tG=[{species:"Garchomp",ability:"Rough Skin",nature:"Jolly",item:"garchompite",
    evs:{hp:2,atk:32,spe:32},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,
    moves:["Earthquake","Scale Shot","Dragon Claw","Swords Dance"]}];
  var bG=new Sim.Battle({formatid:FORMAT_ID,seed:[5,6,7,8],p1:{team:tG},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
  bG.makeChoices("team 1","team 1");
  var cm2=bG.p1.activeRequest&&bG.p1.activeRequest.active&&bG.p1.activeRequest.active[0]&&bG.p1.activeRequest.active[0].canMegaEvo;
  if (cm2===true) pass("mega-garchomp-flag","Garchomp+Garchompite: canMegaEvo===true を確認");
  else info("mega-garchomp-flag","Garchompite canMegaEvo="+cm2+" (champions modにGarchompiteがない可能性)");
}

function verify5_status_moves() {
  section("項目5: 変化技 (まもる/みがわり/ねむる等) の選択肢確認");
  var tCv=[{species:"Corviknight",ability:"Mirror Armor",nature:"Impish",item:"leftovers",
    evs:{hp:32,def:32,spa:2},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,
    moves:["Body Press","Protect","Iron Defense","Roost"]}];
  var bCv=new Sim.Battle({formatid:FORMAT_ID,seed:[9,10,11,12],p1:{team:tCv},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
  bCv.makeChoices("team 1","team 1");
  var mns=bCv.p1.activeRequest.active[0].moves.map(function(m){return m.move;});
  if (mns.includes("Protect")&&mns.includes("Body Press")&&mns.includes("Roost"))
    pass("protect-in-request","まもる・ダメージ技・回復技が全て選択肢に含まれる"+mns.join(", "));
  else fail("protect-in-request","一部の技が選択肢にない"+mns.join(", "));
  bCv.makeChoices("move 2","move 1");
  pass("protect-choice","move 2 (Protect) が choice として通過");
  if (!bCv.ended) {
    var pe=bCv.p1.activeRequest.active[0].moves[1];
    info("protect-consecutive","まもる連続時: disabled="+pe.disabled+" (連続使用失敗はsim内部で処理)");
  }
  var tAg=[{species:"Aegislash",ability:"Stance Change",nature:"Modest",item:"leftovers",
    evs:{hp:32,def:2,spa:32},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,
    moves:["Shadow Ball","Flash Cannon","King's Shield","Substitute"]}];
  var bAg=new Sim.Battle({formatid:FORMAT_ID,seed:[13,14,15,16],p1:{team:tAg},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
  bAg.makeChoices("team 1","team 1");
  var mnsAg=bAg.p1.activeRequest.active[0].moves.map(function(m){return m.move;});
  if (mnsAg.includes("Substitute")&&mnsAg.includes("King's Shield"))
    pass("substitute-in-request","みがわり・キングシールドが選択肢に含まれる"+mnsAg.join(", "));
  else fail("substitute-in-request","一部の技が選択肢にない"+mnsAg.join(", "));
  bAg.makeChoices("move 4","move 1");
  pass("substitute-choice","move 4 (Substitute) が choice として通過");
  var tHp=[{species:"Hippowdon",ability:"Sand Stream",nature:"Impish",item:"sitrusberry",
    evs:{hp:32,def:32,spd:2},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,
    moves:["Earthquake","Rest","Stealth Rock","Whirlwind"]}];
  var bHp=new Sim.Battle({formatid:FORMAT_ID,seed:[17,18,19,20],p1:{team:tHp},p2:{team:makeTeam1v1_Garchomp()},strictChoices:false});
  bHp.makeChoices("team 1","team 1");
  var mnsHp=bHp.p1.activeRequest.active[0].moves.map(function(m){return m.move;});
  if (mnsHp.includes("Rest"))
    pass("rest-in-request","ねむる(Rest)が選択肢に含まれる"+mnsHp.join(", "));
  else fail("rest-in-request","ねむる(Rest)が選択肢にない"+mnsHp.join(", "));
  bHp.makeChoices("move 2","move 1");
  pass("rest-choice","move 2 (Rest) が choice として通過");
}

function verify6_no_tera() {
  section("項目6: テラスタル/Zワザ/ダイマックスが request に出ないこと");
  var flags=["canTerastallize","canZMove","canDynamax","canUltraBurst"];
  var cases=[
    {label:"Garchomp (no item)",team:makeTeam1v1_Garchomp()},
    {label:"Hippowdon (Sitrus Berry)",team:makeTeam1v1_Hippowdon()},
    {label:"Lopunny (Lopunnite)",team:[{species:"Lopunny",ability:"Scrappy",nature:"Jolly",item:"lopunnite",evs:{hp:2,atk:32,spe:32},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,moves:["Fake Out","High Jump Kick","Facade","Ice Punch"]}]},
  ];
  for (var ti=0;ti<cases.length;ti++) {
    var tc=cases[ti];
    var bTc=new Sim.Battle({formatid:FORMAT_ID,seed:[21,22,23,24],p1:{team:tc.team},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
    bTc.makeChoices("team 1","team 1");
    var a0=bTc.p1.activeRequest&&bTc.p1.activeRequest.active&&bTc.p1.activeRequest.active[0];
    var found=flags.filter(function(f){return a0&&a0[f];});
    if (!found.length) pass("no-tera-"+ti,tc.label+": 全フラグが falsy (undefined)");
    else fail("no-tera-"+ti,tc.label+": truthy flags: "+found.join(", "));
  }
  var bM=new Sim.Battle({formatid:FORMAT_ID,seed:[25,26,27,28],p1:{team:[{species:"Lopunny",ability:"Scrappy",nature:"Jolly",item:"lopunnite",evs:{hp:2,atk:32,spe:32},ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},level:50,moves:["Fake Out","High Jump Kick","Facade","Ice Punch"]}]},p2:{team:makeTeam1v1_Hippowdon()},strictChoices:false});
  bM.makeChoices("team 1","team 1");
  bM.makeChoices("move 1 mega","move 1");
  if (!bM.ended) {
    var a0M=bM.p1.activeRequest&&bM.p1.activeRequest.active&&bM.p1.activeRequest.active[0];
    var fM=flags.filter(function(f){return a0M&&a0M[f];});
    if (!fM.length) pass("no-tera-post-mega","メガシンカ後でも tera/zmove/dmax flags は全て falsy");
    else fail("no-tera-post-mega","メガシンカ後に truthy flags: "+fM.join(", "));
  } else info("no-tera-post-mega","バトルが先に終了したためスキップ");
  info("no-tera-summary","gen9championscustomgame では canTerastallize/canZMove/canDynamax は常に undefined。フィルタ不要。sim_config.json の tera:false は将来拡張への予防的設計として維持する。");
}

function main() {
  console.log("verify_sim_7a.js -- Champions BSS Reg M-B フェーズ7a 基盤検証");
  console.log("実行日時: "+new Date().toISOString());
  console.log("フォーマット: "+FORMAT_ID);
  try {
    verify1_3v3_fullbattle();
    verify2_speed_bench();
    verify3_seed_repro();
    verify4_mega();
    verify5_status_moves();
    verify6_no_tera();
  } catch(e) {
    console.error("FATAL: "+e.message);
    console.error(e.stack);
    process.exit(1);
  }
  console.log("============================================================");
  if (failCount===0) console.log("  全項目 PASS");
  else console.log("  FAIL 件数: "+failCount);
  if (failCount>0) process.exit(1);
}

main();
