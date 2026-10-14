import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
const page=await browser.newPage();let calls=[];
await page.route('**/api/thumbnail-data?**',route=>{
 const url=new URL(route.request().url());calls.push(url.href);
 const rivals=url.searchParams.has('rivals')?url.searchParams.get('rivals').split(',').filter(Boolean):['TSII','TSLW','TSYY'];
 const ticker=symbol=>({symbol,tickerInfo:{price:100,currency:'USD'},backtestData:[{date:'2026-10-01',close:100,amount:0.2},{date:'2026-10-08',close:101,amount:0.2}],sourceStatus:{freshness:'fresh',priceDate:'2026-10-08'}});
 return route.fulfill({json:{ticker:ticker('TSLY'),catalog:{underlying:'TSLA'},rivalOptions:['CRSH','TEST','TSII','TSLW','TSYY'],rivals,series:Object.fromEntries([...rivals,'TSLA'].map(s=>[s,ticker(s)])),dataStatus:'fresh'}});
});
await page.route('**/distribution-ticker-*.json',route=>route.fulfill({json:{history:[]}}));
await page.goto('http://127.0.0.1:5173/thumbnail/TSLY');
const picker=page.locator('.rival-candidate-picker');await picker.waitFor();const before=calls.length;
await picker.getByRole('button',{name:'TSII',exact:true}).click();
await picker.getByRole('button',{name:'CRSH',exact:true}).click();
assert.equal(calls.length,before);
await picker.getByRole('button',{name:'확인',exact:true}).click();
await page.waitForFunction(()=>!document.querySelector('.state'));
assert.equal(calls.length,before+1);
assert.equal(new URL(calls.at(-1)).searchParams.get('rivals'),'TSLW,TSYY,CRSH');
await picker.getByRole('button',{name:'추가',exact:true}).click();
await picker.getByRole('button',{name:'CRSH',exact:true}).waitFor();
assert.equal(calls.length,before+1);
console.log('PASS: selection sends no request; confirmation sends one request; add reopens picker without loading');
}finally{await browser.close()}
