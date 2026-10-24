'use strict';
const K=require('./sky_B.js');const C=require('./celestial.js');const assert=require('assert');
const P=K.params();const Q=C.params({rhoM:100});
// 位置一致
for(let t=0;t<1440;t+=7.37){const a=K.sunAt(t,P),b=C.sunAt(t,Q),m=K.moonAt(t,P),n=C.moonAt(t,Q);
 assert(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z)<1e-6);assert(Math.abs(m.x-n.x)+Math.abs(m.y-n.y)+Math.abs(m.z-n.z)<1e-6);}
// 镜像：日月高度永远相反；入冬入夏同在塔腰
for(let t=0;t<720;t+=0.5)assert(Math.abs(K.sunAt(t,P).y+K.moonAt(t,P).y)<1e-9);
for(const t of [0,180,360,540])assert(Math.abs(K.sunAt(t,P).y)<1e-6&&Math.abs(K.moonAt(t,P).y)<1e-6);
assert(K.sunAt(0.01,P).y>0,'入冬后太阳往塔顶走');
// 闭式与数值
const Z=K.place(6670,-4,P);
let lit=0;for(let k=0;k<100000;k++){if(!K.isNight(Z,k/100000,P))lit++;}
assert(Math.abs(lit/100000-K.dayFraction(Z,P))<2e-4,'昼长闭式');
assert(Math.abs(K.blackBoundaryDeg(P)-99.507)<0.01);
let blk=0;for(let k=0;k<32000;k++)if(K.isBlackMoon(k/1000,P))blk++;
assert(Math.abs(blk/1000-K.blackDaysPerMonth(P))<0.01,'黑月日数闭式');
// 庆典每四年
for(let n=0;n<400;n++)assert(K.festivalYear(n,P)===(n%4===0));
// 入冬夜逢黑月只在庆典年（本地子夜）
for(const [s,l] of [[3600,0],[4000,2],[5600,25],[6670,-4],[10007.5,0]]){const O=K.place(s,l,P);
 for(let n=0;n<40;n++){const tm=Math.round(n*P.Y-O.lam/K.TAU)+O.lam/K.TAU;assert(K.isBlackMoon(tm,P)===(n%4===0),'入冬夜黑月 '+s+' '+n);}}
// 本地时：λ=0 在 t=0 子夜
assert(Math.abs(K.localSolarTime(0,K.place(4000,0,P)))<1e-9);
assert(K.season(10,K.place(4000,0,P),P)==='冬'&&K.season(200,K.place(4000,0,P),P)==='夏');
// 黑月高悬数量与分析脚本一致（罪域、四年、每夜≥30分钟）
let nights=0,cnt=0,cur=0,inN=false;
for(let t=-0.5;t<1440;t+=2/1440){const n=K.isNight(Z,t,P);if(n&&!inN){inN=true;cur=0;}if(!n&&inN){inN=false;nights++;if(cur>=30)cnt++;}if(n&&K.moonView(Z,t,P).hanging)cur+=2;}
console.log('罪域 黑月高悬 夜/月',(cnt/nights*32).toFixed(1),'自转周期',K.spinPeriodSec(P).toFixed(0),'s');
console.log('全部断言通过');
