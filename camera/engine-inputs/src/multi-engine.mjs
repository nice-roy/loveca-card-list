// Region-by-region visual recognition using one private, local reference index.
// This module performs no network requests and writes no images or inventory.
import {createEngine,loadCV,recognitionYield,emptyVerifyDetail,LIMITS as SINGLE_LIMITS} from './image-engine.mjs';
import {proposeRegions,DETECTION_LIMITS} from './region-detector.mjs';
import {MAX_REGIONS} from './grid-config.mjs';

export const MULTI_LIMITS=Object.freeze({regions:MAX_REGIONS,pixels:24_000_000,minimumEdge:20,detectionMs:20_000,batchMs:180_000});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const failure=(code,message)=>Object.assign(new Error(message),{code});
const cancelled=()=>failure('CANCELLED','複数枚の照合を中止しました。');
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const timed=(total,prepare,retrieve,verify,yieldWait,verifyDetail)=>({total,prepare,retrieve,verify,other:Math.max(0,total-prepare-retrieve-verify),yieldWait,verifyDetail});
function validateCanvas(canvas){
  if(!canvas||typeof canvas.getContext!=='function'||!Number.isInteger(canvas.width)||!Number.isInteger(canvas.height)||canvas.width<1||canvas.height<1)throw failure('INVALID_IMAGE','写真を選んでください。');
  if(canvas.width*canvas.height>MULTI_LIMITS.pixels)throw failure('INPUT_TOO_LARGE','24MP以下の写真を選んでください。');
}
export function validateRegions(input,regions){
  validateCanvas(input);
  if(!Array.isArray(regions)||regions.length<1||regions.length>MULTI_LIMITS.regions)throw failure('INVALID_REGIONS','カードの範囲を1〜'+MULTI_LIMITS.regions+'個指定してください。');
  const ids=new Set();
  return regions.map((region,i)=>{
    const {x,y,width,height}=region??{};
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<MULTI_LIMITS.minimumEdge||height<MULTI_LIMITS.minimumEdge||x+width>input.width+.01||y+height>input.height+.01)throw failure('INVALID_REGIONS',`${i+1}番の枠が写真の範囲外か、小さすぎます。`);
    if(typeof region.id!=='string'||!region.id||region.id.length>100||ids.has(region.id))throw failure('INVALID_REGIONS','枠の識別番号が不正です。枠を作り直してください。');
    ids.add(region.id);
    const result={id:region.id,source:['auto','manual','grid'].includes(region.source)?region.source:'manual',x,y,width,height};
    if(region.points!==undefined){
      if(!Array.isArray(region.points)||region.points.length!==4||region.points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<x-.01||p.y<y-.01||p.x>x+width+.01||p.y>y+height+.01))throw failure('INVALID_REGIONS','カードの四隅を確認できません。枠を作り直してください。');
      const points=region.points.map(p=>({x:p.x,y:p.y}));let sign=0,area=0;
      for(let j=0;j<4;j++){
        const a=points[j],b=points[(j+1)%4],c=points[(j+2)%4];
        const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
        if(Math.abs(cross)<1||distance(a,b)<MULTI_LIMITS.minimumEdge||(sign&&Math.sign(cross)!==sign))throw failure('INVALID_REGIONS','カードの四隅が交差しているか小さすぎます。');
        sign=Math.sign(cross);area+=a.x*b.y-a.y*b.x;
      }
      if(Math.abs(area)/2<MULTI_LIMITS.minimumEdge**2)throw failure('INVALID_REGIONS','カードの範囲が小さすぎます。');
      result.points=points;
    }
    return result;
  });
}
function cropRegion(cv,input,region){
  const local=document.createElement('canvas'),scale=Math.min(1,SINGLE_LIMITS.processingEdge/Math.max(region.width,region.height));
  local.width=Math.max(1,Math.round(region.width*scale));local.height=Math.max(1,Math.round(region.height*scale));
  const sx=local.width/region.width,sy=local.height/region.height;
  local.getContext('2d',{willReadFrequently:true}).drawImage(input,region.x,region.y,region.width,region.height,0,0,local.width,local.height);
  if(!region.points)return local;
  const points=region.points.map(p=>({x:(p.x-region.x)*sx,y:(p.y-region.y)*sy}));
  const width=Math.max(20,Math.round((distance(points[0],points[1])+distance(points[2],points[3]))/2));
  const height=Math.max(20,Math.round((distance(points[1],points[2])+distance(points[3],points[0]))/2));
  const output=document.createElement('canvas');output.width=width;output.height=height;
  const owned=[],own=v=>(owned.push(v),v);
  try{
    const src=own(cv.imread(local)),dst=own(new cv.Mat());
    const from=own(cv.matFromArray(4,1,cv.CV_32FC2,points.flatMap(p=>[p.x,p.y])));
    const to=own(cv.matFromArray(4,1,cv.CV_32FC2,[0,0,width-1,0,width-1,height-1,0,height-1]));
    const matrix=own(cv.getPerspectiveTransform(from,to));
    cv.warpPerspective(src,dst,matrix,new cv.Size(width,height),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    cv.imshow(output,dst);return output;
  }catch(error){output.width=output.height=0;throw error;}
  finally{for(let i=owned.length-1;i>=0;i--)owned[i].delete();local.width=local.height=0;}
}

export function createMultiEngine({onProgress=()=>{},liveCardIds=[]}={}){
  let generation=0,disposed=false,ready=false,cv,operation,phase='',regionIndex=0,regionTotal=1,initializing;
  const report=(status,progress)=>{try{onProgress({status,progress});}catch{/* UI callback has no effect on recognition. */}};
  const base=createEngine({liveCardIds,onProgress:value=>{
    if(phase==='prepare')report(value.status,value.progress);
    else if(phase==='recognize')report(`${regionIndex+1}/${regionTotal}枚目を照合しています`,(regionIndex+Math.max(0,Math.min(1,value.progress||0)))/regionTotal);
  }});
  const valid=token=>{if(disposed||token!==generation)throw cancelled();};
  const available=()=>{if(disposed)throw failure('DISPOSED','プレビューを開き直してください。');if(!ready)throw failure('NOT_READY','先に画像照合を準備してください。');if(operation)throw failure('BUSY','処理中です。完了または中止を待ってください。');};
  async function initialize(){
    if(disposed)throw failure('DISPOSED','プレビューを開き直してください。');
    if(ready)return;
    if(initializing)return initializing;
    if(operation)throw failure('BUSY','処理中です。完了を待ってください。');
    const token=generation;phase='prepare';
    const task=(async()=>{await base.initialize();valid(token);const holder=await loadCV();valid(token);cv=holder.cv;ready=true;})();
    initializing=task;
    try{await task;}finally{if(initializing===task){initializing=undefined;phase='';}}
  }
  async function detectRegions(input){
    available();validateCanvas(input);
    const token=generation,job={};operation=job;phase='detect';const started=performance.now();
    const check=()=>{valid(token);if(performance.now()-started>MULTI_LIMITS.detectionMs)throw failure('DETECTION_TIMEOUT','範囲の自動検出に時間がかかっています。外枠の分割または手動の枠を使ってください。');};
    try{
      report('カードの範囲を探しています',0);
      const result=await proposeRegions(cv,input,{check,onProgress:p=>report('カードの範囲を探しています',p)});
      check();return {...result,limit:DETECTION_LIMITS.maxRegions,timingsMs:{total:Math.round(performance.now()-started)}};
    }finally{if(operation===job){operation=undefined;phase='';}}
  }
  async function recognizeRegions(input,supplied,{onRegion=()=>{}}={}){
    available();const regions=validateRegions(input,supplied);
    const token=generation,job={};operation=job;phase='recognize';regionTotal=regions.length;
    const started=performance.now(),results=[];
    let prepare=0,retrieve=0,verify=0,completedRegions=0,yieldWait=0;
    const verifyDetail=emptyVerifyDetail();
    const addWait=ms=>{yieldWait+=ms;};
    const check=()=>{valid(token);if(performance.now()-started>MULTI_LIMITS.batchMs)throw failure('BATCH_TIMEOUT','まとめて照合する時間の上限に達しました。枚数を減らして試してください。');};
    try{
      for(let i=0;i<regions.length;i++){
        check();regionIndex=i;report(`${i+1}/${regions.length}枚目を照合しています`,i/regions.length);
        const begin=performance.now(),region=regions[i],crop=cropRegion(cv,input,region);
        const cropMs=performance.now()-begin, waitBefore=yieldWait;
        let out,parts;
        try{
          await recognitionYield(addWait);check();
          const result=await base.recognize(crop,{wholeCard:true});parts=result.timingsMs;check();
          out={region,candidates:result.candidates,additionalCandidates:result.additionalCandidates,status:result.status,warnings:result.warnings,diagnostics:result.diagnostics,requiresUserConfirmation:true,registrationEnabled:false};
        }catch(error){
          if(error.code==='VISUAL_TIMEOUT')parts=error.timingsMs;
          check();
          if(error.code==='CANCELLED')throw error;
          if(error.code==='VISUAL_TIMEOUT')out={region,candidates:[],status:'manual_or_retake',diagnostics:{timeoutPhase:error.timeoutPhase},warnings:['この枠の照合は時間切れになりました。範囲を調整するか手動検索を使ってください。'],requiresUserConfirmation:true,registrationEnabled:false};
          else throw error;
        }finally{
          crop.width=crop.height=0;
          const p=cropMs+(parts?.prepare??0),r=parts?.retrieve??0,v=parts?.verify??0;
          prepare+=p;retrieve+=r;verify+=v;
          yieldWait+=parts?.yieldWait??0;
          const d=parts?.verifyDetail??emptyVerifyDetail();
          for(const key of Object.keys(verifyDetail))verifyDetail[key]+=d[key];
          if(out)out.timingsMs=timed(performance.now()-begin,p,r,v,yieldWait-waitBefore,d);
        }
        results.push(out);check();try{onRegion(out,i,regions.length);}catch{/* UI failures cannot authorize registration. */}
        completedRegions++;
        await recognitionYield(addWait);check();
      }
      report(`${regions.length}枠の照合が終わりました。各カードを確認してください`,1);
      return {status:'completed',regions:results,timingsMs:timed(performance.now()-started,prepare,retrieve,verify,yieldWait,verifyDetail),requiresUserConfirmation:true,registrationEnabled:false};
    }catch(error){
      if(error.code==='BATCH_TIMEOUT')Object.assign(error,{completedRegions,timingsMs:timed(performance.now()-started,prepare,retrieve,verify,yieldWait,verifyDetail)});
      throw error;
    }finally{if(operation===job){operation=undefined;phase='';}}
  }
  async function cancel(){generation++;await base.cancel();await tick();}
  async function dispose(){disposed=true;generation++;ready=false;await base.dispose();cv=undefined;}
  return {initialize,detectRegions,recognizeRegions,cancel,dispose};
}
