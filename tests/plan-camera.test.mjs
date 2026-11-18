import assert from 'node:assert/strict';
import test from 'node:test';
import { fitPlan, panPlan, planViewBox, zoomPlan } from '../app/lib/plan-camera.ts';

test('zoom buttons preserve the centre and zoom in/out are inverse operations', () => {
  const c = {x:30,y:70,unitsPerPixel:.2};
  const zoomed = zoomPlan(c, 1/1.35);
  assert.equal(zoomed.x,c.x);assert.equal(zoomed.y,c.y);
  assert.ok(zoomed.unitsPerPixel<c.unitsPerPixel);
  assert.ok(Math.abs(zoomPlan(zoomed,1.35).unitsPerPixel-c.unitsPerPixel)<1e-12);
});
test('wheel zoom keeps the world point under the pointer fixed, including at limits', () => {
  for(const factor of [.5,2,1e-12,1e12]) {
    const c={x:30,y:70,unitsPerPixel:.2}, dx=120,dy=-100;
    const z=zoomPlan(c,factor,dx,dy);
    assert.ok(Math.abs((c.x+dx*c.unitsPerPixel)-(z.x+dx*z.unitsPerPixel))<1e-8);
    assert.ok(Math.abs((c.y-dy*c.unitsPerPixel)-(z.y-dy*z.unitsPerPixel))<1e-8);
    assert.ok(z.unitsPerPixel>=.0001&&z.unitsPerPixel<=10000);
  }
});
test('canvas and SVG share centre and scale across differently sized panels', () => {
  const c=panPlan({x:30,y:70,unitsPerPixel:.2},50,-30);
  assert.deepEqual(c,{x:20,y:64,unitsPerPixel:.2});
  for(const [w,h] of [[700,480],[1100,560],[380,700]]) {
    const b=planViewBox(c,w,h);
    assert.equal(b[0]+b[2]/2,c.x);assert.equal(-(b[1]+b[3]/2),c.y);
    assert.equal(b[2]/w,c.unitsPerPixel);assert.equal(b[3]/h,c.unitsPerPixel);
  }
});
test('fit includes all bounds and stays finite on tiny or empty views', () => {
  for(const [w,h] of [[700,480],[1,1]]) {
    const c=fitPlan(0,0,100,200,w,h);
    assert.equal(c.x,50);assert.equal(c.y,100);
    assert.ok(Number.isFinite(c.unitsPerPixel)&&c.unitsPerPixel>0);
    assert.ok(c.unitsPerPixel*Math.max(w-68,1)>=100);
    assert.ok(c.unitsPerPixel*Math.max(h-68,1)>=200);
  }
});
