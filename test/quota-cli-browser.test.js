"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseCliUsage,SOURCE}=require('../src/antigravity-cli-quota');
const {createAccountQuotaStore}=require('../src/state-account-quota');
const {primaryWindow}=require('../src/quota-view-model');
const {sessionSnapshotSignature}=require('../src/state-session-snapshot');
const {handleBrowserQuota,ORIGIN}=require('../src/quota-browser-route');
const {EventEmitter}=require('node:events');
test('preserves arbitrary CLI groups, disabled windows, persistence and snapshot updates',()=>{
 const now=Date.now();
 const payload={status:'SUCCESS',command:{name:'usage',data:{groups:[
 {name:'Gemini Models',buckets:[{id:'gemini-weekly',remaining_fraction:.75,window:'weekly'}]},
 {name:'Claude and GPT models',buckets:[{id:'3p-weekly',remaining_fraction:0,window:'weekly'},{id:'3p-5h',remaining_fraction:0,disabled:true,window:'5h'}]},
 {name:'Future model',buckets:[{id:'separate',remaining_fraction:.4}]}
 ]}}};
 const group=parseCliUsage(payload,now);assert.equal(Object.keys(group).length,4);
 const store=createAccountQuotaStore({persistPath:null,now:()=>now});store.update(SOURCE,{antigravityCliQuota:group});
 const sources=store.snapshot({mergeSources:true});assert.equal(sources[0].antigravityCliQuota.group.group1_1.disabled,true);
 assert.equal(primaryWindow(sources,'antigravityQuota',now).remaining,0);
 const first=sessionSnapshotSignature({sessions:[],accountQuota:sources});
 sources[0].antigravityCliQuota.lastSeenAt+=60000;
 assert.notEqual(first,sessionSnapshotSignature({sessions:[],accountQuota:sources}));
 assert.equal(parseCliUsage({status:'ERROR'}),null);
});
test('browser bridge rejects web origins and accepts only quota from pinned extension',()=>{
 let report;const req=new EventEmitter();req.socket={remoteAddress:'127.0.0.1'};req.method='POST';
 req.headers={origin:'https://example.com','content-type':'application/json','x-character-quota':'1'};
 const res={writeHead(code){this.status=code;},end(){}};
 handleBrowserQuota(req,res,()=>{});assert.equal(res.status,403);
 req.headers.origin=ORIGIN;handleBrowserQuota(req,res,(...args)=>{report=args;});
 req.emit('data',JSON.stringify({text:'当前用量 已使用 12% 每周限额 已使用 20%',updated:'刚刚更新',observedAt:Date.now()}));req.emit('end');
 assert.equal(res.status,204);assert.equal(report[1].geminiChatQuota.geminiChatWeekly.usedPercent,20);
});
