// Split only the selected outer boundary. All coordinates stay in photo pixels.
// A projective grid preserves a detected quadrilateral's perspective; a manual
// rectangular selection yields an ordinary equal grid. No image data is read.
import {MAX_REGIONS} from './grid-config.mjs';
const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_GRID'});};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);

function checkedPoints(region){
  const {x,y,width,height}=region??{};
  if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0)
    fail('分割する外枠を選んでください。');
  const points=region.points??[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<x-.01||p.y<y-.01||p.x>x+width+.01||p.y>y+height+.01))
    fail('外枠の四隅を確認できません。囲み直してください。');
  let sign=0;
  for(let i=0;i<4;i++){
    const value=cross(points[i],points[(i+1)%4],points[(i+2)%4]);
    if(Math.abs(value)<1||(sign&&Math.sign(value)!==sign))
      fail('外枠の四隅が交差しているか、範囲が小さすぎます。');
    sign=Math.sign(value);
  }
  return points.map(p=>({x:p.x,y:p.y}));
}

export function splitRegionGrid(region,columns,rows,count=columns*rows){
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows>MAX_REGIONS)
    fail('分割数は1〜'+MAX_REGIONS+'枠にしてください。');
  if(!Number.isInteger(count)||count<1||count>columns*rows)
    fail('カード枚数は1〜配置の枠数にしてください。');
  const [p0,p1,p2,p3]=checkedPoints(region);
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
  const determinant=dx1*dy2-dx2*dy1;
  if(Math.abs(determinant)<1e-8)fail('外枠を分割できません。囲み直してください。');
  const g=(dx3*dy2-dx2*dy3)/determinant,h=(dx1*dy3-dx3*dy1)/determinant;
  const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x;
  const d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y;
  function at(u,v){
    const denominator=g*u+h*v+1;
    if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-8)fail('外枠を分割できません。囲み直してください。');
    return {x:(a*u+b*v+p0.x)/denominator,y:(d*u+e*v+p0.y)/denominator};
  }
  // Share exact boundary coordinates between neighbours to avoid rounding gaps.
  const vertices=Array.from({length:rows+1},(_,r)=>Array.from({length:columns+1},(_,c)=>at(c/columns,r/rows)));
  const result=[];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    if(row*columns+column>=count)continue;
    const points=[vertices[row][column],vertices[row][column+1],vertices[row+1][column+1],vertices[row+1][column]].map(p=>({...p}));
    if(points.some((p,i)=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||distance(p,points[(i+1)%4])<20||Math.abs(cross(p,points[(i+1)%4],points[(i+2)%4]))<1))
      fail('分割後の枠が小さすぎます。カード全体を大きく囲んでください。');
    const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    const width=Math.max(...points.map(p=>p.x))-x,height=Math.max(...points.map(p=>p.y))-y;
    if(width<20||height<20)fail('分割後の枠が小さすぎます。カード全体を大きく囲んでください。');
    result.push({x,y,width,height,points,source:'grid'});
  }
  return result;
}
