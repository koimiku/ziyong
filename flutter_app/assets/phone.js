const accessKey = new URL(location.href).searchParams.get('key');
const element = id => document.getElementById(id);
const video = element('video');
let hls, selected, source, activeLines = [], playback = null, generation = 0, savedAt = 0;

async function api(path, args = {}, body) {
  const url = new URL('/api/' + path, location);
  url.searchParams.set('key', accessKey);
  for (const [key, value] of Object.entries(args)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '操作失败');
  return result;
}
function message(text) { element('status').textContent = text; }
function button(text, action) {
  const result = document.createElement('button'); result.textContent = text;
  result.onclick = () => Promise.resolve(action()).catch(error => message(error.message)); return result;
}
function cards(rows) {
  element('cards').replaceChildren(); element('sources').replaceChildren();
  for (const row of rows) {
    const result = button('', () => choose(row)); result.className = 'card';
    const image = document.createElement('img'); image.loading = 'lazy'; image.src = row.images?.large || ''; image.alt = '';
    const label = document.createElement('span'); label.textContent = row.title || row.name_cn || row.name;
    result.append(image, label); element('cards').append(result);
  }
}
async function listing(type) {
  const token = ++generation; message('正在加载…');
  const rows = type === 'discover' ? await api('catalog') : (await api('library'))[type];
  if (token !== generation) return;
  cards(rows); message('');
}
async function saveProgress() {
  if (!playback || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const context = playback;
  await api('progress', {}, {subject: context.subject, progress: {...context.progress, position: video.currentTime, duration: video.duration}});
}
async function choose(row) {
  await saveProgress().catch(() => {}); video.pause(); playback = null;
  const token = ++generation; selected = row; element('title').textContent = row.title;
  element('watch').hidden = false; element('cards').replaceChildren(); element('sources').replaceChildren(); element('episodes').replaceChildren();
  message('正在搜索片源…');
  const hits = await api('sources', {q: row.title, partition: String(row.id).startsWith('tz:') ? 'tokusatsu' : 'anime'});
  if (token !== generation) return;
  message(hits.length ? '选择片源' : '没有找到结果，可换个名称搜索');
  for (const hit of hits) element('sources').append(button(hit.rule + ' · ' + hit.name, () => chapters(hit)));
}
async function chapters(hit) {
  const token = ++generation; message('正在获取集数…');
  const lines = await api('chapters', {rule: hit.rule, source: hit.source});
  if (token !== generation) return;
  source = hit; activeLines = lines; element('episodes').replaceChildren();
  lines.forEach((line, l) => {
    const title = document.createElement('p'); title.textContent = line.name;
    const grid = document.createElement('div'); grid.className = 'episodes';
    line.episodes.forEach((episode, e) => grid.append(button(episode.name, () => play(episode, l, e))));
    element('episodes').append(title, grid);
  });
  message('请选择集数');
}
async function play(episode, line, index) {
  await saveProgress().catch(() => {}); video.pause(); playback = null;
  const token = ++generation; message('正在解析 ' + episode.name + '…');
  const media = await api('play', {rule: source.rule, page: episode.url});
  if (token !== generation) return;
  hls?.destroy(); hls = null;
  playback = { subject: selected, progress: {sourceName: source.rule, sourceUrl: source.source, lineIndex: line, episodeIndex: index, episodeNumber: episode.name} };
  const resume = selected.progress;
  const same = resume?.sourceName === source.rule && resume?.sourceUrl === source.source && resume?.lineIndex === line && resume?.episodeIndex === index && Number(resume.percent) < 98;
  video.onloadedmetadata = () => { if (same && Number(resume.position) > 0) video.currentTime = Math.min(Number(resume.position), video.duration); };
  if (media.hls && Hls.isSupported()) {
    hls = new Hls(); hls.loadSource(media.url); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) message('视频加载失败，请尝试其他线路'); });
  } else { video.src = media.url; video.play().catch(() => {}); }
  message(episode.name); savedAt = Date.now();
}
element('search').onsubmit = async event => {
  event.preventDefault(); const token = ++generation; message('正在搜索…');
  try { const rows = await api('catalog', {q: element('query').value}); if (token === generation) { cards(rows); message(''); } }
  catch (error) { message(error.message); }
};
for (const id of ['discover', 'collection', 'history']) element(id).onclick = () => listing(id).catch(error => message(error.message));
element('skip').onclick = () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 85); };
element('mark').onclick = () => {
  const menu = document.createElement('div'); menu.className = 'row';
  for (const [status, name] of [['', '未收藏'], ['planned', '想看'], ['watching', '在看'], ['completed', '看过']]) {
    menu.append(button(name, async () => { await api('status', {}, {subject: selected, status}); menu.remove(); message('已更新：' + name); }));
  }
  element('sources').replaceChildren(menu);
};
video.ontimeupdate = () => { if (Date.now() - savedAt > 15000) { savedAt = Date.now(); saveProgress().catch(() => {}); } };
video.onpause = () => saveProgress().catch(() => {});
video.onended = async () => {
  await saveProgress().catch(() => {}); if (!playback) return;
  const {lineIndex: line, episodeIndex: index} = playback.progress;
  const next = activeLines[line]?.episodes[index + 1];
  if (next && !document.hidden) play(next, line, index + 1).catch(error => message(error.message));
};
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveProgress().catch(() => {}); video.pause(); } });
const script = document.createElement('script'); script.src = '/hls.js?key=' + encodeURIComponent(accessKey);
script.onload = () => listing('discover').catch(error => message(error.message));
script.onerror = () => message('播放器组件加载失败，请重新打开连接'); document.head.append(script);
