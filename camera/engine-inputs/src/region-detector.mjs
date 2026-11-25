// On-device card boundary proposals. These are editable proposals, never a count
// of real cards and never an authorization to register inventory.
import {MAX_REGIONS} from './grid-config.mjs';
export const DETECTION_LIMITS = Object.freeze({maxRegions: MAX_REGIONS, edge: 1800, maxContours: 12000});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function orderQuad(points) {
  const center = points.reduce((p,q) => ({x:p.x+q.x/4,y:p.y+q.y/4}),{x:0,y:0});
  const sorted = [...points].sort((a,b) => Math.atan2(a.y-center.y,a.x-center.x)-Math.atan2(b.y-center.y,b.x-center.x));
  let first=0; for(let i=1;i<4;i++) if(sorted[i].x+sorted[i].y<sorted[first].x+sorted[first].y)first=i;
  return [...sorted.slice(first),...sorted.slice(0,first)];
}
function bounds(points) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
}
function intersection(a,b) {
  return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
}
function duplicate(a,b) {
  const overlap=intersection(a,b),small=Math.min(a.width*a.height,b.width*b.height);
  return overlap/Math.max(1,small)>.78 || overlap/Math.max(1,a.width*a.height+b.width*b.height-overlap)>.48;
}

export async function proposeRegions(cv,input,{check=()=>{},onProgress=()=>{}}={}) {
  const scale=Math.min(1,DETECTION_LIMITS.edge/Math.max(input.width,input.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(input.width*scale));canvas.height=Math.max(1,Math.round(input.height*scale));
  canvas.getContext('2d',{willReadFrequently:true}).drawImage(input,0,0,canvas.width,canvas.height);
  const sx=input.width/canvas.width,sy=input.height/canvas.height;
  const owned=[],own=v=>(owned.push(v),v),candidates=[];
  let contourLimitReached=false;
  try {
    check();
    const src=own(cv.imread(canvas)),gray=own(new cv.Mat()),blur=own(new cv.Mat());
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
    const edges=own(new cv.Mat()),closed=own(new cv.Mat()),binary=own(new cv.Mat()),inverse=own(new cv.Mat());
    const kernel=own(cv.Mat.ones(3,3,cv.CV_8U));
    cv.Canny(blur,edges,35,105);cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel);
    cv.threshold(blur,binary,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);
    cv.bitwise_not(binary,inverse);
    // A dark printed frame can have too little luminance contrast for Canny or
    // Otsu. On a reasonably uniform table, color distance from the photo border
    // supplies an independent outline without assuming a particular card count.
    const samples=[];
    const sample=(x,y)=>{const p=(y*canvas.width+x)*4;samples.push([src.data[p],src.data[p+1],src.data[p+2]]);};
    for(let x=0;x<canvas.width;x+=Math.max(1,Math.floor(canvas.width/100))){sample(x,0);sample(x,canvas.height-1);}
    for(let y=0;y<canvas.height;y+=Math.max(1,Math.floor(canvas.height/100))){sample(0,y);sample(canvas.width-1,y);}
    const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const background=[0,1,2].map(channel=>median(samples.map(value=>value[channel])));
    const spread=samples.map(value=>Math.sqrt(value.reduce((sum,v,i)=>sum+(v-background[i])**2,0)/3)).sort((a,b)=>a-b)[Math.floor(samples.length*.9)];
    const masks=[closed,binary,inverse],imageArea=canvas.width*canvas.height;
    if(spread<=35){
      const foreground=own(cv.Mat.zeros(canvas.height,canvas.width,cv.CV_8U)),filled=own(new cv.Mat());
      const threshold=Math.max(16,spread+10),squared=threshold*threshold*3;
      for(let y=0;y<canvas.height;y++){
        for(let x=0;x<canvas.width;x++){
          const pos=y*canvas.width+x,p=pos*4;
          foreground.data[pos]=(src.data[p]-background[0])**2+(src.data[p+1]-background[1])**2+(src.data[p+2]-background[2])**2>squared?255:0;
        }
        if(y%100===0){await tick();check();}
      }
      cv.morphologyEx(foreground,filled,cv.MORPH_CLOSE,kernel);masks.push(filled);
    }
    for(let pass=0;pass<masks.length;pass++) {
      await tick();check();
      const contours=new cv.MatVector(),hierarchy=new cv.Mat();
      try {
        cv.findContours(masks[pass],contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
        if(contours.size()>DETECTION_LIMITS.maxContours)contourLimitReached=true;
        for(let i=0;i<Math.min(contours.size(),DETECTION_LIMITS.maxContours);i++) {
          if(i%150===0){onProgress((pass+i/Math.max(1,contours.size()))/masks.length);await tick();check();}
          const contour=contours.get(i),poly=new cv.Mat();
          try {
            const area=Math.abs(cv.contourArea(contour)),fraction=area/imageArea;
            if(fraction<.009||fraction>.88)continue;
            const perimeter=cv.arcLength(contour,true);
            for(const epsilon of [.015,.025,.04]) {
              cv.approxPolyDP(contour,poly,perimeter*epsilon,true);
              if(poly.rows!==4||!cv.isContourConvex(poly))continue;
              const points=orderQuad(Array.from({length:4},(_,p)=>({x:poly.data32S[p*2],y:poly.data32S[p*2+1]})));
              const lengths=points.map((p,n)=>distance(p,points[(n+1)%4]));
              const width=(lengths[0]+lengths[2])/2,height=(lengths[1]+lengths[3])/2;
              const ratio=Math.min(width,height)/Math.max(width,height);
              if(ratio<.46||ratio>.87||Math.min(width,height)<65||Math.max(lengths[0],lengths[2])/Math.min(lengths[0],lengths[2])>1.65||Math.max(lengths[1],lengths[3])/Math.min(lengths[1],lengths[3])>1.65)continue;
              const box=bounds(points);
              // Exclude the photo's outer border, including wide/portrait backgrounds.
              if(box.x<3&&box.y<3&&box.x+box.width>canvas.width-4&&box.y+box.height>canvas.height-4)continue;
              const rectangularity=area/Math.max(1,width*height);
              if(rectangularity<.68)continue;
              let anglesValid=true;
              for(let j=0;j<4;j++){
                const a=points[(j+3)%4],b=points[j],c=points[(j+1)%4];
                const cosine=Math.abs(((a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y))/Math.max(1,distance(a,b)*distance(c,b)));
                if(cosine>.58){anglesValid=false;break;}
              }
              if(!anglesValid)continue;
              candidates.push({...box,points,area,quality:rectangularity*(1-Math.abs(ratio-.714))});
              break;
            }
          } finally {poly.delete();contour.delete();}
        }
      } finally {hierarchy.delete();contours.delete();}
    }
    check();
    // Large complete outlines win over smaller text/artwork rectangles within them.
    const kept=[];
    for(const item of candidates.sort((a,b)=>b.area-a.area||b.quality-a.quality)) {
      if(kept.some(previous=>duplicate(item,previous)))continue;
      kept.push(item);
    }
    const truncated=kept.length>DETECTION_LIMITS.maxRegions||contourLimitReached;
    const limited=kept.slice(0,DETECTION_LIMITS.maxRegions);
    // Sort approximate rows first, then left to right, for predictable labels.
    limited.sort((a,b)=>{
      const ac=a.y+a.height/2,bc=b.y+b.height/2;
      return Math.abs(ac-bc)<Math.min(a.height,b.height)*.42?a.x-b.x:ac-bc;
    });
    const regions=limited.map((item,i)=>{
      const points=item.points.map(p=>({x:clamp(p.x*sx,0,input.width),y:clamp(p.y*sy,0,input.height)}));
      return {id:`auto-${i+1}`,source:'auto',...bounds(points),points};
    });
    const warnings=[];
    if(!regions.length)warnings.push('カードの範囲を自動で見つけられませんでした。外枠の分割または手動で範囲を追加してください。');
    else warnings.push('枠は自動検出の候補です。1つの枠にカード1枚が収まっているか確認してください。');
    if(truncated)warnings.push('検出処理の上限に達しました。最大'+DETECTION_LIMITS.maxRegions+'枠までです。写っている全カードに枠があるか確認してください。');
    onProgress(1);
    return {regions,truncated,warnings};
  } finally {
    for(let i=owned.length-1;i>=0;i--)owned[i].delete();
    canvas.width=canvas.height=0;
  }
}
