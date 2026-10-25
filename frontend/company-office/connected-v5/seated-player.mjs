import {DirectionalSeatedPlayer} from '../reference-v3/directional-player.mjs';
import {CHAIR_CLIPS} from './furniture-contract.mjs';

/**
 * Draw one immutable full character frame per tick. Screen animation remains
 * owned by the runtime's independent BenchScreenOverlay layers.
 */
export class ConnectedSeatedPlayer extends DirectionalSeatedPlayer {
  constructor(canvas, assets, options = {}) {
    // Preserve the reference CPU raster and its edge rounding from the first draw.
    canvas?.getContext?.('2d', {willReadFrequently: true});
    super(canvas, assets, options);
  }
  /** Presentation only: never change the six business states or their clocks. */
  setPresentation({actorVisible=true,neutral=false}={}){
    if(typeof actorVisible!=='boolean'||typeof neutral!=='boolean')throw new Error('Invalid seat presentation');
    if(this.actorVisible===actorVisible&&this.neutral===neutral)return false;
    this.actorVisible=actorVisible;this.neutral=neutral;this._drawKey=null;return this._render();
  }
  setBenchContext(context){
    // Retain only the furniture mask inputs; no keyboard geometry or hand layer.
    this.benchContext=context ? {
      image:context.image,
      transform:context.transform,
      center:[...context.center],
      stationScale:context.stationScale,
    } : context;
    this._drawKey=null;this._render();return this;
  }
  _screen(){return {key:'bench-external',visible:false,polygon:[],led:null,external:true,state:this.state};}
  _drawChair(layer){
    const bounds=CHAIR_CLIPS[this.direction][layer];if(!bounds)return;
    const [x,y,w,h]=bounds;this.ctx.drawImage(this.images[layer],x,y,w,h,x,y,w,h);
  }
  _render(){
    if(!this.ready)return false;
    const face=this.actorVisible===false||this.neutral?'-':(this.spec.character.animationMode==='full-frame'?this.frame:(this.spec.character.faceVisible===false?'-':this.faceFrame));
    const key=`${this.direction}:${this.state}:${face}:${this.actorVisible!==false}:${!!this.neutral}:${this.reducedMotion}`;
    if(key===this._drawKey)return false;
    const ctx=this.ctx;ctx.clearRect(0,0,192,192);ctx.imageSmoothingEnabled=false;
    this._drawChair('back');
    if(this.actorVisible!==false){
      if(this.neutral){
        // The frozen base pose, without a sleeping/error/working face atlas.
        ctx.drawImage(this.images.base,...this.bodyPlacement());
      }else this._drawActor();
    }
    this._drawChair('front');
    // Cut only lower-body pixels behind the actual new desktop alpha. The face,
    // head template and bodyPlacement are unchanged. No synthetic desk foreground.
    const b=this.benchContext;
    if(b&&this.direction!=='up'){
      const [sx,sy]=this.spec.furniture.seatAnchor,[cx,cy]=b.center,s=b.stationScale,t=b.transform;
      ctx.save();ctx.beginPath();
      if(this.direction==='right')ctx.rect(sx+9,sy-18,192-sx-9,192-sy+18);
      else if(this.direction==='left')ctx.rect(0,sy-18,sx-9,192-sy+18);
      else ctx.rect(0,sy-8,192,192-sy+8);
      ctx.clip();ctx.globalCompositeOperation='destination-out';
      ctx.drawImage(b.image,(t.x-cx)/s+96,(t.y-cy)/s+96,t.width/s,t.height/s);ctx.restore();
    }
    this._drawKey=key;return true;
  }
  snapshot(){
    return {
      ...super.snapshot(),
      animationMode:'full-frame-plus-screen-effects',
      furnitureMode:'chair-only',
      actorVisible:this.actorVisible!==false,
      neutral:!!this.neutral,
      originalChairClips:CHAIR_CLIPS[this.direction],
      benchOcclusion:!!this.benchContext,
      handsRendered:false,
      handsAction:'none',
      keyboardInteraction:false,
      bodyFixed:true,
      headFixed:true,
      tailFixed:true,
      chairFixed:true,
    };
  }
}
