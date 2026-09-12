'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function event() { const listeners = new Set(); return {listeners,addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}; }
function harness({fetchFails=false,settings={}}={}) {
  const storage = {...settings}, created=[], removed=[], updates=[];
  const chrome = {
    runtime:{onMessage:event(),onInstalled:event(),onStartup:event()},
    alarms:{onAlarm:event(),create:async()=>{},clear:async()=>{}},
    storage:{local:{get:async defaults=>({...defaults,...storage}),set:async value=>Object.assign(storage,value)}},
    tabs:{onUpdated:event(),onRemoved:event(),
      create:async value=>{created.push(value);return{id:7,status:'loading'};},
      update:async(id,value)=>{updates.push(value);return{id,status:'complete'};},
      remove:async id=>{removed.push(id);},
      sendMessage:async()=>({ok:true,count:0,imported:0})
    }
  };
  const context = vm.createContext({chrome,console,URL,AbortSignal,setTimeout,clearTimeout,
    fetch:async()=>{if(fetchFails) throw new Error('offline'); return {ok:true,json:async()=>({imported:1,updated:0,
      searches:[{name:'Saved',ebay:'https://www.ebay.it/sch/i.html?_nkw=laptop'}]})};}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../browser-bridge/background.js'),'utf8'),context);
  return {context,chrome,storage,created,removed,updates,run:code=>vm.runInContext(code,context),
    message:(value,sender={})=>new Promise(resolve=>[...chrome.runtime.onMessage.listeners][0](value,sender,resolve))};
}
test('import acknowledgement waits for the server and reports a saved count',async()=>{
  const bg=harness();
  const response=await bg.message({type:'radar-listings',platform:'EBAY',items:[{}]},{url:'https://www.ebay.it/sch/i.html',tab:{id:1}});
  assert.equal(response.ok,true);assert.equal(response.imported,1);
});
test('offline server never produces a success acknowledgement',async()=>{
  const bg=harness({fetchFails:true});
  const response=await bg.message({type:'radar-listings',platform:'EBAY',items:[{}]},{url:'https://www.ebay.it/sch/i.html',tab:{id:1}});
  assert.equal(response.ok,false);assert.equal(response.error,'offline');
});
test('wrong origin cannot submit listings',async()=>{
  const bg=harness();
  const response=await bg.message({type:'radar-listings',platform:'EBAY',items:[]},{url:'https://evil.example',tab:{id:1}});
  assert.equal(response.ok,false);
});
test('explicit empty selection does not run every saved search',async()=>{
  const bg=harness({settings:{useAllSearches:false,selectedSearches:[],enabledPlatforms:['EBAY']}});
  await bg.run('runSavedSearches()');
  assert.equal(bg.created.length,0);
  assert.equal(bg.storage.automationStatus.running,false);
  assert.equal(bg.storage.automationStatus.message,'Nessuna ricerca selezionata.');
});
test('fast page load completes and removes its event listeners',async()=>{
  const bg=harness();
  await bg.run("navigateTab(7,'https://ebay.it/sch/i.html')");
  assert.equal(bg.chrome.tabs.onUpdated.listeners.size,0);
  assert.equal(bg.chrome.tabs.onRemoved.listeners.size,0);
});
test('pagination advances from an existing source page',()=>{
  const bg=harness();
  const url=new URL(bg.run("pageUrl('https://vinted.it/catalog?page=3&x=1','VINTED',2)"));
  assert.equal(url.searchParams.get('page'),'4');
  assert.equal(url.searchParams.get('x'),'1');
});
test('live status is not confused by stale stored running state',async()=>{
  const bg=harness({settings:{automationStatus:{running:true}}});
  assert.equal((await bg.message({type:'get-run-status'})).running,false);
});
