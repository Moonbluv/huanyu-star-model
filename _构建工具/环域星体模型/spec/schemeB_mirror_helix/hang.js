'use strict';
const C=require('./celestial.js');const {D2R,TAU}=C;const P=C.params({rhoM:100});
const LOCS=[['圣禁城',3600,0],['伊美忒',4000,2],['涅赫莱恩',5600,25],['罪域',6670,-4],['赤道',Math.PI*P.R/2,0]];
const f0=x=>x.toFixed(0);
for(const L of LOCS){const O=C.place(L[1],L[2],P);
 const els=[],gams=[],side={E:0,W:0};const nightsW=new Set(),nightsS=new Set();
 for(let t=0;t<1440;t+=2/1440){const S=C.sunAt(t,P);if(!C.blocked(O,S,P))continue;const M=C.moonAt(t,P);
  if(!C.blocked(M,S,P)||C.blocked(O,M,P))continue;const B=C.wallHit(O,M,P);if(C.blocked(O,B,P)||C.blocked(B,S,P))continue;
  const lk=C.look(O,M);if(lk.e<30)continue;
  els.push(Math.abs(C.elongation(t,P)));let g=((M.lam-O.lam)/D2R)%360;if(g>180)g-=360;if(g<-180)g+=360;gams.push(Math.abs(g));
  if(C.dot(O.E,lk.v)>0)side.E++;else side.W++;
  const night=Math.floor(t+0.5-O.lam/TAU);const doy=((t%360)+360)%360;(doy<180?nightsW:nightsS).add(night);}
 els.sort((a,b)=>a-b);gams.sort((a,b)=>a-b);const q=(a,p)=>a[Math.floor(p*(a.length-1))];
 console.log(`${L[0]}\t黑月离太阳 ${f0(q(els,0.05))}°–${f0(q(els,0.95))}°｜月与本地经度差 ${f0(q(gams,0.05))}°–${f0(q(gams,0.95))}°｜在塔东侧 ${f0(side.E/(side.E+side.W)*100)}%｜冬半年 ${(nightsW.size/(720/32)).toFixed(1)} 夜/月，夏半年 ${(nightsS.size/(720/32)).toFixed(1)} 夜/月`);}
