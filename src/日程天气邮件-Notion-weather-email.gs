/** Notion Weather Email. Copyright (c) 2026 miao010625. MIT License. */

function previewDigest() { return runDigest_(true); }
function sendDailyDigest() { return runDigest_(false); }

function config_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  function required(key) {
    const value = String(p[key] || '').trim();
    if (!value) throw new Error('Missing Script Property: ' + key);
    return value;
  }
  function number(key, fallback, min, max, integer) {
    const raw = p[key] === undefined ? fallback : p[key];
    const value = Number(raw);
    if (String(raw).trim() === '' || !Number.isFinite(value) || value < min || value > max ||
        (integer && !Number.isInteger(value))) throw new Error('Invalid Script Property: ' + key);
    return value;
  }
  const source = required('NOTION_DATA_SOURCE_ID').replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(source)) throw new Error('NOTION_DATA_SOURCE_ID must be a UUID, not a URL.');
  const to = required('EMAIL_TO');
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) throw new Error('EMAIL_TO must be one email address.');
  const zone = required('TIME_ZONE');
  try { Utilities.formatDate(new Date(), zone, 'yyyy-MM-dd'); }
  catch (error) { throw new Error('Invalid TIME_ZONE.'); }
  const enabled = p.SEND_ENABLED || 'false';
  if (!['true', 'false'].includes(enabled)) throw new Error('SEND_ENABLED must be true or false.');
  return {token:required('NOTION_TOKEN'),source:source,to:to,zone:zone,
    dateProperty:p.NOTION_DATE_PROPERTY || 'Date',version:p.NOTION_API_VERSION || '2026-03-11',
    latitude:number('LATITUDE', '', -90, 90),longitude:number('LONGITUDE', '', -180, 180),
    label:p.LOCATION_LABEL || 'Your location',hour:number('SEND_HOUR', 8, 0, 23, true),
    enabled:enabled === 'true',deadline:Date.now() + 240000};
}

function request_(url, options, provider, deadline) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (Date.now() >= deadline) throw new Error('Request runtime budget exceeded.');
    let response;
    try { response = UrlFetchApp.fetch(url, Object.assign({muteHttpExceptions:true,followRedirects:false}, options)); }
    catch (error) {
      if (attempt === 3) throw new Error(provider + ' network request failed.');
    }
    const code = response ? response.getResponseCode() : 0;
    if (code >= 200 && code < 300) {
      try { return JSON.parse(response.getContentText()); }
      catch (error) { throw new Error(provider + ' returned invalid JSON.'); }
    }
    if (response && code !== 429 && code < 500) throw new Error(provider + ' request failed (HTTP ' + code + ').');
    if (attempt === 3) throw new Error(provider + ' request failed after retries.');
    const headers = response && response.getHeaders ? response.getHeaders() : {};
    const seconds = Number(headers['Retry-After'] || headers['retry-after'] || 0);
    const delay = Math.max(1000 * Math.pow(2, attempt), Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0);
    if (Date.now() + delay >= deadline) throw new Error(provider + ' retry exceeds runtime budget.');
    Utilities.sleep(delay);
  }
}

function notion_(cfg, endpoint, body) {
  return request_('https://api.notion.com/v1/' + endpoint, {
    method:body ? 'post' : 'get',contentType:'application/json',
    headers:{Authorization:'Bearer ' + cfg.token,'Notion-Version':cfg.version},
    ...(body ? {payload:JSON.stringify(body)} : {}),
  }, 'Notion', cfg.deadline);
}

function readPages_(cfg) {
  const schema = notion_(cfg, 'data_sources/' + cfg.source);
  if (!schema.properties || !schema.properties[cfg.dateProperty] || schema.properties[cfg.dateProperty].type !== 'date') {
    throw new Error('Configured Notion Date property is missing or has the wrong type.');
  }
  const pages = [], seen = new Set();
  let cursor = null;
  do {
    // Read the complete source so ranges starting before today are not lost.
    const result = notion_(cfg, 'data_sources/' + cfg.source + '/query',
      Object.assign({page_size:100}, cursor ? {start_cursor:cursor} : {}));
    if (!Array.isArray(result.results) || typeof result.has_more !== 'boolean') throw new Error('Invalid Notion pagination.');
    result.results.forEach(function(page) {
      if (!page || page.object !== 'page' || !page.properties) throw new Error('Invalid Notion page.');
      pages.push(page);
    });
    cursor = result.has_more ? result.next_cursor : null;
    if (result.has_more && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) throw new Error('Incomplete or repeated Notion pagination.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return pages;
}

function dateOnly_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Invalid Notion date.');
  return value;
}

function instant_(value, zone) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i.test(value)) {
    throw new Error('Invalid Notion timestamp.');
  }
  dateOnly_(value.slice(0, 10));
  if (Number(value.slice(11,13)) > 23 || Number(value.slice(14,16)) > 59 || Number(value.slice(17,19) || 0) > 59) throw new Error('Invalid Notion time.');
  let date;
  if (/(Z|[+-]\d{2}:\d{2})$/i.test(value)) date = new Date(value);
  else {
    const clean = value.replace(/\.\d+$/, '');
    date = Utilities.parseDate(clean, zone, clean.length === 16 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid Notion timestamp.');
  return date;
}

function agenda_(pages, cfg, today) {
  const items = [];
  pages.forEach(function(page) {
    if (page.archived || page.in_trash) return;
    const date = (page.properties[cfg.dateProperty] || {}).date;
    if (!date || !date.start) return;
    const titleProp = Object.keys(page.properties).map(function(key) { return page.properties[key]; })
      .find(function(p) {return p && p.type === 'title';});
    const title = titleProp && Array.isArray(titleProp.title) ? titleProp.title.map(function(t) {
      return t.plain_text || (t.text || {}).content || '';
    }).join('').trim() : '';
    const item = {title:title || 'Untitled',time:'All day',order:''};
    if (/^\d{4}-\d{2}-\d{2}$/.test(date.start)) {
      const start = dateOnly_(date.start), end = dateOnly_(date.end || date.start);
      if (end < start) throw new Error('Notion date end precedes start.');
      if (start > today || end < today) return;
    } else {
      const start = instant_(date.start, date.time_zone || cfg.zone);
      const end = date.end ? instant_(date.end, date.time_zone || cfg.zone) : null;
      if (end && end <= start) throw new Error('Notion timestamp end must follow start.');
      const startDay = Utilities.formatDate(start, cfg.zone, 'yyyy-MM-dd');
      // The end of a timed range is exclusive; subtract a millisecond before comparing days.
      const lastDay = end ? Utilities.formatDate(new Date(end.getTime() - 1), cfg.zone, 'yyyy-MM-dd') : startDay;
      if (startDay > today || lastDay < today) return;
      item.order = start.toISOString();
      const fmt = startDay === today && (!end || Utilities.formatDate(end, cfg.zone, 'yyyy-MM-dd') === today)
        ? 'HH:mm' : 'yyyy-MM-dd HH:mm';
      item.time = Utilities.formatDate(start, cfg.zone, fmt) + (end ? ' – ' + Utilities.formatDate(end, cfg.zone, fmt) : '');
    }
    items.push(item);
  });
  return items.sort(function(a,b) {return a.order.localeCompare(b.order) || a.title.localeCompare(b.title);});
}

function weather_(cfg, today) {
  const params = {latitude:cfg.latitude,longitude:cfg.longitude,timezone:cfg.zone,forecast_days:1,
    current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max'};
  const query = Object.keys(params).map(function(key) {return key + '=' + encodeURIComponent(params[key]);}).join('&');
  const data = request_('https://api.open-meteo.com/v1/forecast?' + query, {}, 'Weather', cfg.deadline);
  if (!data.current || !data.daily || !Array.isArray(data.daily.time)) throw new Error('Weather data incomplete.');
  const index = data.daily.time.indexOf(today);
  if (index < 0 || !Number.isFinite(data.current.temperature_2m)) throw new Error('Weather data unavailable for today.');
  function daily(key) {const a = data.daily[key]; return Array.isArray(a) && Number.isFinite(a[index]) ? a[index] : 'N/A';}
  function current(key) {return Number.isFinite(data.current[key]) ? data.current[key] : 'N/A';}
  return ['Weather for ' + cfg.label,
    'Temperature: ' + current('temperature_2m') + ' °C (feels like ' + current('apparent_temperature') + ' °C)',
    'Low / high: ' + daily('temperature_2m_min') + ' / ' + daily('temperature_2m_max') + ' °C',
    'Humidity: ' + current('relative_humidity_2m') + '%',
    'Maximum precipitation probability: ' + daily('precipitation_probability_max') + '%',
    'Maximum UV index: ' + daily('uv_index_max'),
    'Forecast: Open-Meteo (https://open-meteo.com/).'].join('\n');
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function(c) {return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}

function compose_(cfg, now) {
  const today = Utilities.formatDate(now, cfg.zone, 'yyyy-MM-dd');
  const items = agenda_(readPages_(cfg), cfg, today);
  let weather;
  try {weather = weather_(cfg, today);}
  catch (error) {weather = 'Weather unavailable. Your Notion agenda is included below.';}
  const lines = items.length ? items.map(function(item) {return item.time + ' — ' + item.title;}) : ['No scheduled items today.'];
  const body = ['Your daily briefing',today + ' (' + cfg.zone + ')','',weather,'','Today in Notion',...lines].join('\n');
  return {date:today,count:items.length,subject:'Your daily briefing — ' + today,body:body,
    htmlBody:'<!doctype html><html lang="en"><body><h1>Your daily briefing</h1><p>' + escapeHtml_(today + ' (' + cfg.zone + ')') +
      '</p><h2>Weather</h2><p>' + escapeHtml_(weather).replace(/\n/g,'<br>') + '</p><h2>Today in Notion</h2><ul>' +
      lines.map(function(line) {return '<li>' + escapeHtml_(line) + '</li>';}).join('') + '</ul></body></html>'};
}

function deliveryKey_(cfg) {
  const text = [cfg.to.toLowerCase(),cfg.source,cfg.zone,cfg.dateProperty].join('|');
  return 'DELIVERY_' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(byte) {return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);}).join('');
}

function runDigest_(preview) {
  const cfg = config_();
  if (preview || !cfg.enabled) {
    const digest = compose_(cfg, new Date());
    // Preview logs are private to your Apps Script project. Never share them publicly.
    Logger.log(digest.body);
    return digest;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another digest execution is already running.');
  try {
    const today = Utilities.formatDate(new Date(), cfg.zone, 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties(), key = deliveryKey_(cfg);
    const previous = props.getProperty(key);
    if (previous) {
      let state;
      try {state = JSON.parse(previous);} catch (error) {throw new Error('Invalid delivery state; inspect Script Properties.');}
      if (!state || typeof state.date !== 'string' || !['pending','sent'].includes(state.status)) throw new Error('Invalid delivery state; inspect Script Properties.');
      if (state.date >= today) return {status:state.status,date:state.date};
    }
    const digest = compose_(cfg, new Date());
    if (digest.date !== today || Utilities.formatDate(new Date(), cfg.zone, 'yyyy-MM-dd') !== today) throw new Error('Local day changed; run again.');
    if (Date.now() >= cfg.deadline) throw new Error('Runtime budget reached before delivery.');
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Insufficient daily email quota.');
    // Reserve before sending: a provider timeout may happen after successful delivery.
    props.setProperty(key, JSON.stringify({date:today,status:'pending'}));
    try {MailApp.sendEmail({to:cfg.to,subject:digest.subject,body:digest.body,htmlBody:digest.htmlBody,name:'Daily Notion Briefing'});}
    catch (error) {throw new Error('Email delivery is uncertain. Automatic resend is blocked for today; check Sent mail before resetting delivery state.');}
    props.setProperty(key, JSON.stringify({date:today,status:'sent'}));
    return {status:'sent',date:today,count:digest.count};
  } finally {lock.releaseLock();}
}

function installDailyTrigger() {
  const cfg = config_();
  if (!cfg.enabled) throw new Error('Set SEND_ENABLED=true after reviewing a preview.');
  removeDailyTrigger();
  ScriptApp.newTrigger('sendDailyDigest').timeBased().atHour(cfg.hour).nearMinute(0).everyDays(1).inTimezone(cfg.zone).create();
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(trigger);
  });
}
