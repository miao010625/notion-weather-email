const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const file = path.join(__dirname, '../src/日程天气邮件-Notion-weather-email.gs');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const id = '11111111111141118111111111111111';
function page(start, end, title = 'Example task') {
  return {object: 'page', id, properties: {Name: {type:'title', title:[{plain_text:title}]}, Date:{type:'date', date:{start,end}}}};
}
function harness(extra = {}) {
  const props = {NOTION_TOKEN:'test-token', NOTION_DATA_SOURCE_ID:id, EMAIL_TO:'reader@example.com',
    TIME_ZONE:'UTC', LATITUDE:'0', LONGITUDE:'0', ...extra};
  const sent = [], logs = [], calls = [], triggers = [];
  let failMail = false, locked = false, quota = 10;
  let pages = [page('2026-10-22', null)], next = null, weatherFails = false;
  const FixedDate = class extends Date { constructor(...args) {super(...(args.length ? args : ['2026-10-22T12:00:00Z']));} static now(){return Date.parse('2026-10-22T12:00:00Z');} };
  function formatDate(d, zone, fmt) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return fmt === 'yyyy-MM-dd' ? date : fmt === 'HH:mm' ? `${parts.hour}:${parts.minute}` : `${date} ${parts.hour}:${parts.minute}`;
  }
  const context = vm.createContext({Date: FixedDate, console,
    Logger:{log:x=>logs.push(x)},
    PropertiesService:{getScriptProperties:()=>({getProperties:()=>({...props}), getProperty:k=>props[k]||null, setProperty:(k,v)=>props[k]=v})},
    LockService:{getScriptLock:()=>({tryLock:()=>!locked, releaseLock:()=>{}})},
    Utilities:{formatDate, parseDate:(s,zone)=>{if(zone!=='UTC') throw Error('Test only supports naive UTC'); return new Date(s+'Z');}, sleep:()=>{},
      DigestAlgorithm:{SHA_256:'sha256'}, Charset:{UTF_8:'utf8'}, computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},
    MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:m=>{sent.push(m); if(failMail)throw Error('private provider details');}},
    ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger:name=>{
      const t={getHandlerFunction:()=>name}; const b={timeBased:()=>b,atHour:()=>b,nearMinute:()=>b,everyDays:()=>b,inTimezone:()=>b,create:()=>triggers.push(t)};return b;}},
    UrlFetchApp:{fetch:(url, options)=>{
      calls.push({url,options});
      if(url.startsWith('https://api.notion.com/')) {
        const value = url.endsWith('/query') ? (next ? next() : {results:pages,has_more:false}) : {properties:{Date:{type:'date'}}};
        return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(value),getHeaders:()=>({})};
      }
      if(weatherFails)throw Error('private location request');
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({current:{temperature_2m:0,apparent_temperature:-1,relative_humidity_2m:60,weather_code:0},daily:{time:['2026-10-22'],temperature_2m_max:[12],temperature_2m_min:[-2],precipitation_probability_max:[40],uv_index_max:[3]}})};
    }},
  });
  vm.runInContext(source, context, {filename:file});
  return {c:context,props,sent,logs,calls,triggers,setPages:v=>pages=v,setNext:v=>next=v,setMailFailure:()=>failMail=true,setLocked:()=>locked=true,setQuota:v=>quota=v,setWeatherFailure:()=>weatherFails=true};
}
test('preview is the default and never sends or marks delivery',()=>{const h=harness();h.c.sendDailyDigest();assert.equal(h.sent.length,0);assert.ok(h.logs[0].includes('Example task'));assert.equal(Object.keys(h.props).some(x=>x.startsWith('DELIVERY_')),false);});
test('explicit preview never sends even when enabled',()=>{const h=harness({SEND_ENABLED:'true'});h.c.previewDigest();assert.equal(h.sent.length,0);});
test('enabled send creates English plain and HTML email once per day',()=>{const h=harness({SEND_ENABLED:'true'});h.c.sendDailyDigest();h.c.sendDailyDigest();assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'reader@example.com');assert.match(h.sent[0].body,/0 °C/);assert.match(h.sent[0].subject,/2026-10-22/);});
test('an ambiguous send failure blocks automatic resend',()=>{const h=harness({SEND_ENABLED:'true'});h.setMailFailure();assert.throws(()=>h.c.sendDailyDigest(),/delivery is uncertain/i);h.c.sendDailyDigest();assert.equal(h.sent.length,1);});
test('concurrent execution does not send',()=>{const h=harness({SEND_ENABLED:'true'});h.setLocked();assert.throws(()=>h.c.sendDailyDigest(),/running/i);assert.equal(h.calls.length,0);});
test('insufficient quota does not reserve delivery',()=>{const h=harness({SEND_ENABLED:'true'});h.setQuota(0);assert.throws(()=>h.c.sendDailyDigest(),/quota/i);assert.equal(Object.keys(h.props).some(x=>x.startsWith('DELIVERY_')),false);});
test('HTML escapes Notion titles and configurable location',()=>{const h=harness({LOCATION_LABEL:'<img src=x>'});h.setPages([page('2026-10-22',null,'<script>alert(1)</script>')]);const d=h.c.previewDigest();assert.ok(d.htmlBody.includes('&lt;script&gt;'));assert.ok(!d.htmlBody.includes('<img src=x>'));});
test('multi-day all-day tasks include their inclusive last day',()=>{const h=harness();h.setPages([page('2026-10-20','2026-10-22')]);assert.equal(h.c.previewDigest().count,1);});
test('timed ranges ending at midnight are excluded from that next day',()=>{const h=harness();h.setPages([page('2026-10-21T23:00:00Z','2026-10-22T00:00:00Z')]);assert.equal(h.c.previewDigest().count,0);});
test('timed events are selected in the configured time zone',()=>{const h=harness({TIME_ZONE:'Asia/Tokyo'});h.setPages([page('2026-10-21T16:00:00Z',null)]);assert.equal(h.c.previewDigest().count,1);});
test('overnight ranges remain visible on the following day',()=>{const h=harness();h.setPages([page('2026-10-21T23:00:00Z','2026-10-22T02:00:00Z')]);assert.equal(h.c.previewDigest().count,1);});
test('archived and undated pages do not appear',()=>{const h=harness();const p=page('2026-10-22');p.archived=true;h.setPages([p,page(null,null)]);assert.equal(h.c.previewDigest().count,0);});
test('complete pagination is read before composing',()=>{const h=harness();let n=0;h.setNext(()=>++n===1?{results:[],has_more:true,next_cursor:'second'}:{results:[page('2026-10-22')],has_more:false});assert.equal(h.c.previewDigest().count,1);assert.equal(n,2);});
test('repeated pagination stops before email delivery',()=>{const h=harness({SEND_ENABLED:'true'});h.setNext(()=>({results:[],has_more:true,next_cursor:'loop'}));assert.throws(()=>h.c.sendDailyDigest(),/pagination/i);assert.equal(h.sent.length,0);});
test('weather failure still allows a clearly labeled agenda email',()=>{const h=harness({SEND_ENABLED:'true'});h.setWeatherFailure();h.c.sendDailyDigest();assert.match(h.sent[0].body,/Weather unavailable/);assert.doesNotMatch(h.sent[0].body,/private location/);});
test('invalid date ranges stop before delivery',()=>{const h=harness({SEND_ENABLED:'true'});h.setPages([page('2026-10-22','2026-10-21')]);assert.throws(()=>h.c.sendDailyDigest(),/end/i);assert.equal(h.sent.length,0);});
for (const [key,value] of [['LATITUDE','91'],['LONGITUDE','-181'],['LATITUDE',''],['SEND_ENABLED','yes'],['EMAIL_TO','a@example.com,b@example.com'],['SEND_HOUR','24'],['TIME_ZONE','Invalid/Zone']]) {
  test(`invalid ${key} is rejected before requests`,()=>{const h=harness({[key]:value});assert.throws(()=>h.c.previewDigest());assert.equal(h.calls.length,0);});
}
test('secrets are not sent to the weather provider or preview log',()=>{const h=harness();h.c.previewDigest();const w=h.calls.find(x=>x.url.startsWith('https://api.open-meteo.com/'));assert.equal(w.options.headers,undefined);assert.ok(!JSON.stringify(h.logs).includes('test-token'));assert.ok(!JSON.stringify(h.logs).includes('reader@example.com'));});
test('trigger installation requires sending enabled and preserves other triggers',()=>{const h=harness();assert.throws(()=>h.c.installDailyTrigger(),/SEND_ENABLED/);h.props.SEND_ENABLED='true';h.triggers.push({getHandlerFunction:()=> 'otherAutomation'});h.c.installDailyTrigger();h.c.installDailyTrigger();assert.equal(h.triggers.length,2);assert.equal(h.triggers.filter(t=>t.getHandlerFunction()==='sendDailyDigest').length,1);});
test('Notion authorization failures expose neither token nor response body',()=>{const h=harness({SEND_ENABLED:'true'});h.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>401,getContentText:()=> 'private body test-token'});assert.throws(()=>h.c.sendDailyDigest(),/^Error: Notion request failed \(HTTP 401\)\.$/);assert.equal(h.sent.length,0);});
test('Notion retries rate limits and includes the API version header',()=>{const h=harness();const original=h.c.UrlFetchApp.fetch;let attempts=0;h.c.UrlFetchApp.fetch=(url,options)=>{assert.equal(options.headers['Notion-Version'],'2026-03-11');return ++attempts===1?{getResponseCode:()=>429,getHeaders:()=>({'Retry-After':'1'})}:original(url,options);};assert.equal(h.c.notion_(h.c.config_(),'data_sources/'+id).properties.Date.type,'date');assert.equal(attempts,2);});
test('an excessive Retry-After stops without sleeping past the runtime budget',()=>{const h=harness();h.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>429,getHeaders:()=>({'Retry-After':'99999'})});assert.throws(()=>h.c.notion_(h.c.config_(),'data_sources/'+id),/runtime budget/);});
test('invalid Notion schema aborts delivery',()=>{const h=harness({SEND_ENABLED:'true'});h.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({properties:{Date:{type:'rich_text'}}})});assert.throws(()=>h.c.sendDailyDigest(),/wrong type/);assert.equal(h.sent.length,0);});
test('invalid clock times are rejected rather than normalized',()=>{const h=harness();h.setPages([page('2026-10-22T24:30:00Z',null)]);assert.throws(()=>h.c.previewDigest(),/Invalid Notion time/);});
test('missing Notion pagination cursor aborts delivery',()=>{const h=harness({SEND_ENABLED:'true'});h.setNext(()=>({results:[],has_more:true}));assert.throws(()=>h.c.sendDailyDigest(),/pagination/);assert.equal(h.sent.length,0);});
test('corrupt delivery state stops instead of sending again',()=>{const h=harness({SEND_ENABLED:'true'});h.props[h.c.deliveryKey_(h.c.config_())]='broken';assert.throws(()=>h.c.sendDailyDigest(),/delivery state/);assert.equal(h.sent.length,0);});
test('an invalid weather date is never presented as today’s forecast',()=>{const h=harness();const original=h.c.UrlFetchApp.fetch;h.c.UrlFetchApp.fetch=(url,options)=>url.startsWith('https://api.open-meteo.com/')?{getResponseCode:()=>200,getContentText:()=>JSON.stringify({current:{temperature_2m:10},daily:{time:['2000-01-01']}})}:original(url,options);assert.match(h.c.previewDigest().body,/Weather unavailable/);});
