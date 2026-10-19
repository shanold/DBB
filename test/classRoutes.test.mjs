import test from 'node:test';
import assert from 'node:assert/strict';
import {classPath,parseClassRoute} from '../public/src/classRoutes.mjs';
test('class and challenge URLs contain readable names with no generated codes',()=>{
 assert.equal(classPath('ms-tech-8d139bae'),'/ms-tech');
 assert.equal(classPath('ms-tech-8d139bae','bridge-challenge-1-abcdef'),'/ms-tech/bridge-challenge-1');
 assert.deepEqual(parseClassRoute('/ms-tech/'),{classSlug:'ms-tech',challengeSlug:null,legacy:false});
 assert.deepEqual(parseClassRoute('/ms-tech/bridge-challenge-1'),{classSlug:'ms-tech',challengeSlug:'bridge-challenge-1',legacy:false});
});
test('both previous URL formats redirect to readable URLs and application routes are reserved',()=>{
 for(const path of ['/class/ms-tech-8d139bae/bridge-challenge-1-abcdef','/ms-tech/8d139bae/bridge-challenge-1-abcdef']){
 const route=parseClassRoute(path);assert.equal(route.legacy,true);assert.equal(classPath(route.classSlug,route.challengeSlug),'/ms-tech/bridge-challenge-1');}
 for(const path of ['/classroom','/src/app.mjs','/api/status','/assets/tractor-trailer.png'])assert.equal(parseClassRoute(path),null);
});
