#!/usr/bin/env node
import assert from 'node:assert/strict';
import {DRAG_THRESHOLD_PX, pointerCssPosition, exceededDragThreshold, stationIdFromObjects, shouldIgnoreWheelZoom} from '../frontend/office/map-loader.mjs';

const station = {getData(name) { return name === 'companyOfficeStationId' ? 'desk-12' : null; }};
const lockedRoomLabel = {getData(name) { return name === 'companyOfficeLocked' ? true : null; }};

assert.equal(DRAG_THRESHOLD_PX, 8, 'the click-vs-drag threshold should remain a small screen-space distance');
assert.equal(stationIdFromObjects([lockedRoomLabel, station]), 'desk-12');
assert.equal(stationIdFromObjects([lockedRoomLabel]), null);
assert.equal(shouldIgnoreWheelZoom({zoomLocked:true, objects:[]}), true);
assert.equal(shouldIgnoreWheelZoom({zoomLocked:false, objects:[]}), false);
assert.equal(shouldIgnoreWheelZoom({zoomLocked:false, objects:[lockedRoomLabel]}), true);
assert.equal(shouldIgnoreWheelZoom({zoomLocked:false, objects:[station]}), false);
assert.equal(exceededDragThreshold({x: 10, y: 10}, {x: 16, y: 14}), false);
assert.equal(exceededDragThreshold({x: 10, y: 10}, {x: 17, y: 15}), true);
assert.equal(exceededDragThreshold({x: 10, y: 10}, {x: 10, y: 10}), false);
assert.equal(exceededDragThreshold(null, {x: 1, y: 1}), false);
console.log('PASS office map hover/click interaction helpers');

// A physical backing canvas must not shrink the CSS click tolerance on Retina.
for(const density of [1,2,4]){
  const canvas={width:1000*density,height:500*density,getBoundingClientRect:()=>({width:1000,height:500})};
  const origin=pointerCssPosition({x:20*density,y:30*density},canvas);
  assert.equal(exceededDragThreshold(origin,pointerCssPosition({x:23*density,y:30*density},canvas)),false);
  assert.equal(exceededDragThreshold(origin,pointerCssPosition({x:28*density,y:30*density},canvas)),false);
  assert.equal(exceededDragThreshold(origin,pointerCssPosition({x:29*density,y:30*density},canvas)),true);
}
console.log('PASS CSS-pixel drag tolerance at backing densities 1, 2, 4');
