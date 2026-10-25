#!/usr/bin/env node
import assert from 'node:assert/strict';
import {launchBrowser,openV5} from './connected_v5_qa_helpers.mjs';

const browser=await launchBrowser();
const {context,page,errors,failedResponses,blockedWrites}=await openV5(browser);
const out={passed:0,failed:0,checks:[],screenshots:[]};
async function check(name,fn){try{const evidence=await fn();out.checks.push({name,pass:true,evidence});out.passed++;console.log('PASS',name);}catch(error){out.checks.push({name,pass:false,error:error.stack});out.failed++;console.error('FAIL',name,error.message);}}
async function stationPoint(id){
  return page.evaluate(id=>{
    const r=window.officeRuntime,s=r.getStation(id),cam=r.scene.cameras.main,canvas=r.scene.sys.game.canvas,rect=canvas.getBoundingClientRect();
    const [x,y]=s.center,scaleX=rect.width/canvas.width,scaleY=rect.height/canvas.height;
    return {x:rect.left+(x-cam.worldView.x)*cam.zoom*scaleX,y:rect.top+(y-cam.worldView.y)*cam.zoom*scaleY,active:r.activeStation,view:r.view,camera:[cam.scrollX,cam.scrollY,cam.zoom],epoch:s.epoch};
  },id);
}
try{
  await check('hover marks a workstation without moving the camera or resetting its clock',async()=>{
    const target='desk-09',before=await stationPoint(target);
    await page.mouse.move(before.x,before.y);
    await page.waitForTimeout(120);
    const after=await page.evaluate(()=>({hovered:window.officeRuntime.hoveredStation,camera:[window.officeRuntime.scene.cameras.main.scrollX,window.officeRuntime.scene.cameras.main.scrollY,window.officeRuntime.scene.cameras.main.zoom],selectionVisible:Boolean(window.officeRuntime.hoverSelection)}));
    assert.equal(after.hovered,target);assert.deepEqual(after.camera,before.camera);assert.equal(after.selectionVisible,true);
    const epoch=await page.evaluate(id=>window.officeRuntime.getStation(id).epoch,target);assert.equal(epoch,before.epoch);
    await page.screenshot({path:'assets/company-office-connected-v5/qa/map-hover-desk-09.png'});
    return after;
  });
  await check('dragging from a workstation pans the map but does not select or focus it',async()=>{
    await page.evaluate(()=>window.officeRuntime.setView('overview'));
    const target='desk-09',before=await stationPoint(target),activeBefore=before.active;
    await page.mouse.move(before.x,before.y);await page.mouse.down();await page.mouse.move(before.x+70,before.y+26,{steps:4});await page.mouse.up();await page.waitForTimeout(80);
    const after=await page.evaluate(()=>({active:window.officeRuntime.activeStation,view:window.officeRuntime.view,camera:[window.officeRuntime.scene.cameras.main.scrollX,window.officeRuntime.scene.cameras.main.scrollY,window.officeRuntime.scene.cameras.main.zoom]}));
    assert.equal(after.active,activeBefore);assert.equal(after.view,'overview');assert.notDeepEqual(after.camera,before.camera);
    return {activeBefore,activeAfter:after.active,cameraBefore:before.camera,cameraAfter:after.camera};
  });
  await check('a stationary click still selects without focusing',async()=>{
    await page.evaluate(()=>window.officeRuntime.setView('overview'));
    const target='desk-09',point=await stationPoint(target);
    await page.mouse.move(point.x,point.y);await page.mouse.click(point.x,point.y);await page.waitForTimeout(80);
    const after=await page.evaluate(()=>({active:window.officeRuntime.activeStation,view:window.officeRuntime.view}));
    assert.equal(after.active,target);assert.equal(after.view,'overview');return after;
  });
  assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[]);assert.deepEqual(blockedWrites,[]);
}catch(error){out.failed++;out.failure=error.stack;console.error(error);try{await page.screenshot({path:'assets/company-office-connected-v5/qa/map-hover-failure.png'});}catch{}}
finally{out.completedAt=new Date().toISOString();await context.close();await browser.close();console.log(JSON.stringify(out,null,2));process.exitCode=out.failed?1:0;}
