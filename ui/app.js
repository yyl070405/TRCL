const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LOADER_LABEL = { vanilla: '原版', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const state = { data: null, selected: localStorage.getItem('mc.selected') || null, job: null, timer: null, versions: null };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
}

/* ---------------- state ---------------- */

async function refresh() {
  try {
    state.data = await api('/api/state');
    if (!state.data.instances.some((i) => i.id === state.selected)) {
      state.selected = state.data.instances[0]?.id || null;
    }
    localStorage.setItem('mc.selected', state.selected || '');
    render();
  } catch (e) {
    $('#main').innerHTML = `<div class="empty">连不上本地服务：${esc(e.message)}<br /><br />请确认 <code>npm start</code> 仍在运行。</div>`;
  }
}

function currentInstance() {
  return state.data?.instances.find((i) => i.id === state.selected) || null;
}

function render() {
  renderAccountChip();
  renderSidebar();
  renderMain();
}

function renderAccountChip() {
  const acc = state.data?.accounts.find((a) => a.selected) || state.data?.accounts[0];
  $('#accountsBtn').textContent = acc ? `${acc.name}${acc.type === 'msa' ? ' · 正版' : ''}` : '未登录';
}

function renderSidebar() {
  const list = state.data?.instances || [];
  $('#instanceList').innerHTML = list.length
    ? list
        .map(
          (i) => `<button class="instance-item ${i.id === state.selected ? 'active' : ''}" data-id="${esc(i.id)}">
            <span class="name">${i.running ? '<span class="dot-running">●</span> ' : ''}${esc(i.name)}</span>
            <span class="sub">${esc(i.mcVersion)} · ${esc(LOADER_LABEL[i.loaderType] || i.loaderType)}</span>
          </button>`,
        )
        .join('')
    : '<div class="hint" style="padding:8px 4px">还没有实例</div>';
}

function renderMain() {
  const inst = currentInstance();
  if (!inst) {
    $('#main').innerHTML = `<div class="empty">
      <div>
        <div style="font-size:34px;margin-bottom:10px">⛏</div>
        还没有游戏实例<br /><br />
        <button class="primary" id="emptyNew">新建实例</button>
      </div>
    </div>`;
    $('#emptyNew')?.addEventListener('click', openNewInstance);
    return;
  }

  const hasAccount = (state.data.accounts || []).length > 0;
  const requiredHint = hasAccount ? '' : '<div class="hint" style="margin-top:8px">还没有账号，点击右上角“未登录”添加离线或微软账号后才能启动。</div>';

  $('#main').innerHTML = `
    <section class="card hero">
      <div class="hero-info">
        <h1>${esc(inst.name)}</h1>
        <div class="meta">
          <span class="badge accent">${esc(inst.mcVersion)}</span>
          <span class="badge">${esc(LOADER_LABEL[inst.loaderType] || inst.loaderType)}${inst.loaderVersion ? ' ' + esc(inst.loaderVersion) : ''}</span>
          <span class="badge">${inst.running ? '运行中' : '未运行'}</span>
        </div>
        <div class="hint" style="margin-top:10px">实例目录：${esc(inst.dir)}</div>
        ${requiredHint}
      </div>
      <div class="hero-actions">
        ${
          inst.running
            ? '<button class="secondary" id="stopBtn">停止游戏</button>'
            : `<button class="primary" id="launchBtn" ${hasAccount ? '' : 'disabled'}>启动游戏</button>`
        }
        <button class="secondary" id="repairBtn">检查文件</button>
        <button class="secondary" id="gameSettingsBtn">游戏设置</button>
        <button class="secondary" id="exportBtn">导出实例</button>
        ${state.data.capabilities?.input ? '<button class="secondary" id="hudBtn">HUD 触屏</button>' : ''}
        <select id="memSel" style="width:auto" title="最大内存">
          ${[1024, 2048, 4096, 6144, 8192].map((m) => `<option value="${m}" ${m === inst.memoryMb ? 'selected' : ''}>${m / 1024} GB 内存</option>`).join('')}
        </select>
        <button class="danger" id="deleteBtn">删除</button>
      </div>
      <div id="jobPanel" class="job-panel"></div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2>模组</h2>
        <div class="actions">
          <button class="mini" id="searchModsBtn">搜索模组</button>
          <button class="mini" id="openModsBtn">打开目录</button>
        </div>
      </div>
      <div id="modsBox"><div class="hint">加载中…</div></div>
    </section>
  `;

  $('#launchBtn')?.addEventListener('click', () => launch(inst.id));
  $('#stopBtn')?.addEventListener('click', () => stop(inst.id));
  $('#repairBtn')?.addEventListener('click', () => installInstance(inst.id));
  $('#gameSettingsBtn')?.addEventListener('click', () => openGameSettings(inst));
  $('#exportBtn')?.addEventListener('click', () => openExport(inst));
  $('#hudBtn')?.addEventListener('click', () => window.openHud(inst.id));
  $('#deleteBtn')?.addEventListener('click', () => removeInstance(inst));
  $('#memSel')?.addEventListener('change', async (e) => {
    await api(`/api/instances/${inst.id}`, { method: 'PATCH', body: { memoryMb: Number(e.target.value) } });
    toast('已更新内存设置');
    refresh();
  });
  $('#searchModsBtn')?.addEventListener('click', () => openModSearch(inst));
  $('#openModsBtn')?.addEventListener('click', () => toast(`模组目录：${inst.dir}/mods`));

  renderJobPanel();
  loadMods(inst);
}

/* ---------------- 模组列表 ---------------- */

async function loadMods(inst) {
  const box = $('#modsBox');
  if (!box) return;
  try {
    const { mods, manifest } = await api(`/api/instances/${inst.id}/mods`);
    if (!mods.length) {
      box.innerHTML = '<div class="hint">还没有模组。点“搜索模组”从 Modrinth 安装，或把 jar 直接放进 mods 目录。</div>';
      return;
    }
    box.innerHTML = mods
      .map(
        (m) => `<div class="mod-row ${m.enabled ? '' : 'disabled'}" data-file="${esc(m.file)}">
          <input type="checkbox" ${m.enabled ? 'checked' : ''} data-act="toggle" />
          <div class="mod-main">
            <div class="mod-name">${esc(m.name || m.file)}</div>
            <div class="mod-sub">${esc(m.version ? 'v' + m.version + ' · ' : '')}${esc(m.loader || '')} · ${esc(m.file)}</div>
          </div>
          <button class="mini danger" data-act="delete">删除</button>
        </div>`,
      )
      .join('');

    box.querySelectorAll('.mod-row').forEach((row) => {
      const file = row.dataset.file;
      row.querySelector('[data-act="toggle"]').addEventListener('change', async (e) => {
        e.target.disabled = true;
        try {
          await api(`/api/instances/${inst.id}/mods/toggle`, { method: 'POST', body: { file } });
          await loadMods(inst);
        } catch (err) {
          toast(err.message, 'error');
          e.target.checked = !e.target.checked;
          e.target.disabled = false;
        }
      });
      row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm(`删除 ${file}？`)) return;
        try {
          await api(`/api/instances/${inst.id}/mods/${encodeURIComponent(file)}`, { method: 'DELETE' });
          toast('已删除');
          loadMods(inst);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="hint">读取模组失败：${esc(e.message)}</div>`;
  }
}

/* ---------------- 任务 ---------------- */

function renderJobPanel() {
  const panel = $('#jobPanel');
  if (!panel) return;
  const job = state.job;
  if (!job) {
    panel.innerHTML = '';
    return;
  }
  const p = job.progress || {};
  const running = job.status === 'running';
  const total = p.total || 0;
  const done = p.done || 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const bytes = p.bytesTotal ? ` · ${(p.bytesDone / 1048576).toFixed(1)} / ${(p.bytesTotal / 1048576).toFixed(1)} MB` : '';
  const logs = (job.logs || []).slice(-120).join('\n');

  panel.innerHTML = `
    <div class="job-head"><span>${esc(p.label || (running ? '处理中…' : job.status))}${bytes}</span><span>${running ? '进行中' : job.status === 'done' ? '完成' : '失败'}</span></div>
    <div class="bar ${total ? '' : 'indeterminate'}"><i style="width:${total ? pct : 35}%"></i></div>
    ${job.error ? `<div class="hint" style="color:var(--danger);margin-top:8px">${esc(job.error)}</div>` : ''}
    <pre class="logs" id="jobLogs">${esc(logs)}</pre>
  `;
  const pre = $('#jobLogs');
  if (pre) pre.scrollTop = pre.scrollHeight;
}

function watchJob(jobId) {
  clearInterval(state.timer);
  state.job = { id: jobId, status: 'running', progress: { label: '已提交…' }, logs: [] };
  renderJobPanel();

  const tick = async () => {
    try {
      const job = await api(`/api/jobs/${jobId}`);
      state.job = job;
      renderJobPanel();
      if (job.status !== 'running') {
        clearInterval(state.timer);
        state.timer = null;
        if (job.type === 'launch') {
          toast(job.error ? `启动失败：${job.error}` : '游戏已退出');
        } else {
          toast(job.error ? `失败：${job.error}` : '完成', job.error ? 'error' : '');
        }
        await refresh();
        if (job.type === 'mods' || job.type === 'modpack') {
          const inst = currentInstance();
          if (inst) loadMods(inst);
        }
      }
    } catch (e) {
      clearInterval(state.timer);
      state.timer = null;
      toast(e.message, 'error');
    }
  };
  tick();
  state.timer = setInterval(tick, 800);
}

async function launch(id) {
  try {
    toast('正在准备启动…');
    const { jobId } = await api(`/api/instances/${id}/launch`, {
      method: 'POST',
      body: { locale: navigator.language || 'en_us' },
    });
    watchJob(jobId);
    setTimeout(refresh, 1200);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function stop(id) {
  try {
    const r = await api(`/api/instances/${id}/stop`, { method: 'POST' });
    toast(r.stopped ? '已发送停止信号' : '没有正在运行的进程');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function installInstance(id) {
  try {
    const { jobId } = await api(`/api/instances/${id}/install`, { method: 'POST' });
    watchJob(jobId);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function openExport(inst) {
  const body = `
    <div class="field"><label>导出格式</label>
      <select id="exFormat">
        <option value="mrpack">Modrinth (.mrpack) — Prism / HMCL / Modrinth App</option>
        <option value="multimc">Prism / MultiMC 实例 (.zip)</option>
      </select>
    </div>
    <label class="hint" style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" id="exSaves" style="width:auto" /> 包含存档
    </label>
    <div class="hint" style="margin-top:8px">只导出实例的 mods、config、options.txt；版本和资源由目标启动器自行安装。</div>
    <div class="modal-actions">
      <button class="secondary" id="exCancel">取消</button>
      <button class="primary" id="exGo">导出并下载</button>
    </div>`;
  modal('导出实例', body, (root) => {
    root.querySelector('#exCancel').onclick = closeModal;
    root.querySelector('#exGo').onclick = async () => {
      try {
        const r = await api(`/api/instances/${inst.id}/export`, {
          method: 'POST',
          body: {
            format: root.querySelector('#exFormat').value,
            includeSaves: root.querySelector('#exSaves').checked,
          },
        });
        closeModal();
        toast(`已导出 ${(r.size / 1024).toFixed(1)} KB`);
        window.location.href = `/api/exports/${encodeURIComponent(r.name)}`;
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

async function openGameSettings(inst) {
  let data;
  try {
    data = await api(`/api/instances/${inst.id}/options`);
  } catch (e) {
    return toast(e.message, 'error');
  }
  const o = data.options || {};
  const langs = state.data.languages || [['en_us', 'English']];
  const num = (k, d) => (o[k] !== undefined ? Number(o[k]) : d);
  const sel = (v, options) =>
    options.map(([value, label]) => `<option value="${esc(value)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('');

  const body = `
    <div class="row-2">
      <div class="field"><label>游戏语言</label>
        <select id="gsLang">${sel(o.lang || 'zh_cn', langs)}</select>
      </div>
      <div class="field"><label>图形</label>
        <select id="gsGraphics">${sel(o.graphicsMode ?? 1, [[0, '流畅'], [1, '均衡'], [2, '极致']])}</select>
      </div>
    </div>
    <div class="row-2">
      <div class="field"><label>渲染距离: <b id="gsRdVal">${num('renderDistance', 8)}</b></label>
        <input id="gsRd" type="range" min="2" max="32" step="1" value="${num('renderDistance', 8)}" />
      </div>
      <div class="field"><label>模拟距离: <b id="gsSdVal">${num('simulationDistance', 8)}</b></label>
        <input id="gsSd" type="range" min="4" max="32" step="1" value="${num('simulationDistance', 8)}" />
      </div>
    </div>
    <div class="row-2">
      <div class="field"><label>界面缩放</label>
        <select id="gsGui">${sel(o.guiScale ?? 0, [[0, '自动'], [1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']])}</select>
      </div>
      <div class="field"><label>最大帧率</label>
        <select id="gsFps">${sel(o.maxFps || 120, [[60, '60'], [120, '120'], [144, '144'], [240, '240'], [260, '无限制']])}</select>
      </div>
    </div>
    <div class="row-2">
      <div class="field"><label>粒子效果</label>
        <select id="gsParticles">${sel(o.particles ?? 0, [[0, '全部'], [1, '减少'], [2, '最少']])}</select>
      </div>
      <div class="field"><label>实体阴影</label>
        <select id="gsShadow">${sel(o.entityShadows ?? 'true', [['true', '开'], ['false', '关']])}</select>
      </div>
    </div>
    <div class="field"><label>平滑光照</label>
      <select id="gsAo">${sel(o.ao ?? 'true', [['true', '开'], ['false', '关']])}</select>
    </div>
    <div class="hint">语言只在 options.txt 还没有 lang 时自动写入；这里可以手动改。</div>
    <div class="modal-actions">
      <button class="secondary" id="gsCancel">取消</button>
      <button class="primary" id="gsSave">保存</button>
    </div>`;

  modal('游戏设置', body, (root) => {
    root.querySelector('#gsCancel').onclick = closeModal;
    const bind = (id, out) => {
      const el = root.querySelector(id);
      el.oninput = () => (root.querySelector(out).textContent = el.value);
    };
    bind('#gsRd', '#gsRdVal');
    bind('#gsSd', '#gsSdVal');

    root.querySelector('#gsSave').onclick = async () => {
      const patch = {
        lang: root.querySelector('#gsLang').value,
        graphicsMode: Number(root.querySelector('#gsGraphics').value),
        renderDistance: Number(root.querySelector('#gsRd').value),
        simulationDistance: Number(root.querySelector('#gsSd').value),
        guiScale: Number(root.querySelector('#gsGui').value),
        particles: Number(root.querySelector('#gsParticles').value),
        maxFps: Number(root.querySelector('#gsFps').value),
        entityShadows: root.querySelector('#gsShadow').value,
        ao: root.querySelector('#gsAo').value,
      };
      try {
        await api(`/api/instances/${inst.id}/options`, { method: 'PUT', body: { patch } });
        closeModal();
        toast('游戏设置已保存');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

async function removeInstance(inst) {
  if (!confirm(`删除实例「${inst.name}」？存档和模组会一起删除。`)) return;
  try {
    await api(`/api/instances/${inst.id}`, { method: 'DELETE' });
    state.selected = null;
    toast('已删除');
    refresh();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------------- 弹窗 ---------------- */

function modal(title, bodyHtml, onOpen) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-back"><div class="modal"><h2>${title}</h2>${bodyHtml}</div></div>`;
  const back = root.querySelector('.modal-back');
  back.addEventListener('click', (e) => {
    if (e.target === back) closeModal();
  });
  onOpen?.(root.querySelector('.modal'));
  return root.querySelector('.modal');
}
function closeModal() {
  $('#modalRoot').innerHTML = '';
}

async function openNewInstance() {
  const body = `
    <div class="field"><label>实例名称</label><input id="niName" placeholder="例如：1.21.4 生存" /></div>
    <div class="field"><label>游戏版本</label><select id="niVersion"><option>加载中…</option></select></div>
    <div class="row-2">
      <div class="field"><label>加载器</label>
        <select id="niLoader">
          ${Object.entries(LOADER_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>加载器版本</label><select id="niLoaderVersion"><option value="">自动选择</option></select></div>
    </div>
    <div class="hint" id="niHint"></div>
    <div class="modal-actions">
      <button class="secondary" id="niCancel">取消</button>
      <button class="primary" id="niCreate">创建并安装</button>
    </div>`;

  const el = modal('新建实例', body, async (root) => {
    root.querySelector('#niCancel').onclick = closeModal;
    const vSel = root.querySelector('#niVersion');
    const lSel = root.querySelector('#niLoader');
    const lvSel = root.querySelector('#niLoaderVersion');
    const hint = root.querySelector('#niHint');

    try {
      state.versions = state.versions || (await api('/api/versions'));
      const releases = state.versions.versions.filter((v) => v.type === 'release');
      vSel.innerHTML = releases.map((v) => `<option value="${esc(v.id)}">${esc(v.id)}${v.id === state.versions.latest.release ? '（最新）' : ''}</option>`).join('');
      vSel.value = state.versions.latest.release;
      root.querySelector('#niName').value = `${state.versions.latest.release} 生存`;
    } catch (e) {
      hint.textContent = `获取版本失败：${e.message}`;
    }

    const refreshLoaders = async () => {
      const mc = vSel.value;
      const type = lSel.value;
      lvSel.innerHTML = '<option value="">自动选择</option>';
      if (type === 'vanilla') return;
      hint.textContent = '正在获取加载器版本…';
      try {
        const data = await api(`/api/loaders?mc=${encodeURIComponent(mc)}`);
        const list = (data[type] || []).slice(0, 40);
        lvSel.innerHTML = list.length
          ? '<option value="">自动选择（推荐）</option>' +
            list.map((v) => `<option value="${esc(v.version)}">${esc(v.version)}${v.stable ? ' · 稳定' : ''}</option>`).join('')
          : '<option value="">该版本暂无</option>';
        hint.textContent = list.length ? '' : `这个版本没有 ${LOADER_LABEL[type]}`;
      } catch (e) {
        hint.textContent = `获取失败：${e.message}`;
      }
    };

    vSel.onchange = refreshLoaders;
    lSel.onchange = refreshLoaders;

    root.querySelector('#niCreate').onclick = async () => {
      const name = root.querySelector('#niName').value.trim();
      if (!name) return toast('请填写实例名', 'error');
      const btn = root.querySelector('#niCreate');
      btn.disabled = true;
      btn.textContent = '创建中…';
      try {
        const inst = await api('/api/instances', {
          method: 'POST',
          body: { name, mcVersion: vSel.value, loaderType: lSel.value, loaderVersion: lvSel.value || null },
        });
        closeModal();
        state.selected = inst.id;
        await refresh();
        toast('实例已创建，开始安装…');
        installInstance(inst.id);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '创建并安装';
        toast(e.message, 'error');
      }
    };
  });
}

function openSettings() {
  const s = state.data.settings;
  const javas = state.data.java || [];
  const body = `
    <div class="field"><label>下载源</label>
      <select id="stMirror">
        <option value="official" ${s.mirror === 'official' ? 'selected' : ''}>Mojang 官方</option>
        <option value="bmclapi" ${s.mirror === 'bmclapi' ? 'selected' : ''}>BMCLAPI 镜像（国内加速，可能不稳）</option>
      </select>
    </div>
    <div class="field"><label>默认 Java</label>
      <select id="stJava">
        <option value="">自动选择（推荐）</option>
        ${javas.map((j) => `<option value="${esc(j.path)}" ${s.javaPath === j.path ? 'selected' : ''}>Java ${esc(j.major)} (${esc(j.version)})</option>`).join('')}
      </select>
      <div class="hint" style="margin-top:6px">检测到 ${javas.length} 个 Java。缺 Java 时可一键下载：</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        ${[25, 21, 17, 11, 8].map((v) => `<button class="mini" data-jre="${v}">Java ${v}</button>`).join('')}
      </div>
      <div class="hint" style="margin-top:6px">下载 Zulu JRE，解压到数据目录 runtime/。启动时缺对应版本也会自动下载。</div>
    </div>
    <div class="field"><label>微软登录 client id（可选）</label>
      <input id="stMs" value="${esc(s.msClientId || '')}" placeholder="Azure 应用 ID，用于正版登录" />
      <div class="hint" style="margin-top:6px">在 Azure 门户注册“移动和桌面应用”，把 client id 填这里即可用设备码登录。</div>
    </div>
    <div class="row-2">
      <div class="field"><label>默认内存 (MB)</label><input id="stMem" type="number" value="${s.defaultMemoryMb}" /></div>
      <div class="field"><label>窗口尺寸</label>
        <div style="display:flex;gap:6px">
          <input id="stW" type="number" value="${s.defaultWidth}" />
          <input id="stH" type="number" value="${s.defaultHeight}" />
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="stCancel">关闭</button>
      <button class="primary" id="stSave">保存</button>
    </div>`;

  modal('设置', body, (root) => {
    root.querySelector('#stCancel').onclick = closeModal;
    root.querySelector('#stSave').onclick = async () => {
      try {
        await api('/api/settings', {
          method: 'PATCH',
          body: {
            mirror: root.querySelector('#stMirror').value,
            javaPath: root.querySelector('#stJava').value,
            msClientId: root.querySelector('#stMs').value.trim(),
            defaultMemoryMb: Number(root.querySelector('#stMem').value) || 2048,
            defaultWidth: Number(root.querySelector('#stW').value) || 854,
            defaultHeight: Number(root.querySelector('#stH').value) || 480,
          },
        });
        closeModal();
        toast('设置已保存');
        refresh();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    root.querySelectorAll('[data-jre]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const { jobId } = await api('/api/java/install', { method: 'POST', body: { major: Number(b.dataset.jre) } });
          closeModal();
          watchJob(jobId);
        } catch (e) {
          b.disabled = false;
          toast(e.message, 'error');
        }
      };
    });
  });
}

function openAccounts() {
  const accounts = state.data.accounts || [];
  const body = `
    <div style="margin-bottom:14px">
      ${
        accounts.length
          ? accounts
              .map(
                (a) => `<div class="result-row">
                  <div class="grow">
                    <div class="title">${esc(a.name)} ${a.selected ? '<span class="badge accent">当前</span>' : ''}</div>
                    <div class="desc">${a.type === 'msa' ? '微软正版账号' : '离线账号'} · ${esc(a.id)}</div>
                  </div>
                  ${a.selected ? '' : `<button class="mini" data-select="${esc(a.id)}">切换</button>`}
                  <button class="mini danger" data-remove="${esc(a.id)}">删除</button>
                </div>`,
              )
              .join('')
          : '<div class="hint">还没有账号。</div>'
      }
    </div>
    <div class="field"><label>添加离线账号</label>
      <div style="display:flex;gap:8px">
        <input id="acName" placeholder="3-16 位字母数字下划线" />
        <button class="secondary" id="acAdd" style="flex:0 0 auto">添加</button>
      </div>
    </div>
    <div style="border-top:1px solid var(--line);margin:14px 0"></div>
    <div class="field"><label>微软正版登录</label>
      ${state.data.settings.msClientId ? '<div class="hint" id="msHint">点击下方按钮获取设备码。</div><div id="msBox"></div><button class="secondary wide" id="msStart" style="margin-top:8px">开始微软登录</button>' : '<div class="hint">请先在设置里填写微软 client id。</div>'}
    </div>
    <div class="modal-actions"><button class="secondary" id="acClose">关闭</button></div>`;

  modal('账号', body, (root) => {
    root.querySelector('#acClose').onclick = closeModal;
    root.querySelector('#acAdd').onclick = async () => {
      const name = root.querySelector('#acName').value.trim();
      try {
        await api('/api/accounts/offline', { method: 'POST', body: { name } });
        closeModal();
        toast('账号已添加');
        refresh();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    root.querySelectorAll('[data-select]').forEach((b) => {
      b.onclick = async () => {
        await api('/api/accounts/select', { method: 'POST', body: { uuid: b.dataset.select } });
        closeModal();
        refresh();
      };
    });
    root.querySelectorAll('[data-remove]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('删除这个账号？')) return;
        await api(`/api/accounts/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' });
        closeModal();
        refresh();
      };
    });

    const msStart = root.querySelector('#msStart');
    if (msStart) {
      msStart.onclick = async () => {
        try {
          const s = await api('/api/accounts/microsoft/start', { method: 'POST' });
          root.querySelector('#msBox').innerHTML = `
            <div class="code-box">${esc(s.userCode)}</div>
            <div class="hint">在浏览器打开 <a href="${esc(s.verificationUri)}" target="_blank" style="color:var(--accent)">${esc(s.verificationUri)}</a> 并输入上面的代码。</div>
            <div class="hint" id="msPoll">等待授权…</div>`;
          const timer = setInterval(async () => {
            try {
              const r = await api(`/api/accounts/microsoft/${s.id}`);
              const poll = root.querySelector('#msPoll');
              if (!poll) return clearInterval(timer);
              if (r.status === 'done') {
                clearInterval(timer);
                await api(`/api/accounts/microsoft/${s.id}/finish`, { method: 'POST' });
                closeModal();
                toast(`已登录：${r.account.name}`);
                refresh();
              } else if (r.status === 'error' || r.status === 'expired') {
                clearInterval(timer);
                poll.textContent = r.error || '登录失败';
                poll.style.color = 'var(--danger)';
              }
            } catch (e) {
              clearInterval(timer);
            }
          }, 2000);
        } catch (e) {
          toast(e.message, 'error');
        }
      };
    }
  });
}

async function openModSearch(inst) {
  const body = `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input id="msQ" placeholder="搜索 Modrinth 模组…" />
      <button class="secondary" id="msGo" style="flex:0 0 auto">搜索</button>
    </div>
    <div class="hint" style="margin-bottom:8px">匹配 ${esc(inst.mcVersion)} · ${esc(LOADER_LABEL[inst.loaderType] || inst.loaderType)}</div>
    <div id="msResults"><div class="hint">输入关键词开始搜索。</div></div>
    <div class="modal-actions"><button class="secondary" id="msClose">关闭</button></div>`;

  modal('安装模组', body, (root) => {
    root.querySelector('#msClose').onclick = closeModal;
    const results = root.querySelector('#msResults');
    const doSearch = async () => {
      const q = root.querySelector('#msQ').value.trim();
      results.innerHTML = '<div class="hint">搜索中…</div>';
      try {
        const data = await api(
          `/api/mods/search?q=${encodeURIComponent(q)}&mc=${encodeURIComponent(inst.mcVersion)}&loader=${encodeURIComponent(inst.loaderType)}`,
        );
        results.innerHTML = data.hits.length
          ? data.hits
              .map(
                (m) => `<div class="result-row">
                  <img src="${esc(m.icon || '')}" alt="" onerror="this.style.visibility='hidden'" />
                  <div class="grow">
                    <div class="title">${esc(m.title)}</div>
                    <div class="desc">${esc(m.description || '')}</div>
                    <div class="desc">↓ ${m.downloads.toLocaleString()} · ${esc(m.author || '')}</div>
                  </div>
                  <button class="mini" data-install="${esc(m.id)}">安装</button>
                </div>`,
              )
              .join('')
          : '<div class="hint">没有找到适配的模组。</div>';

        results.querySelectorAll('[data-install]').forEach((b) => {
          b.onclick = async () => {
            b.disabled = true;
            b.textContent = '安装中';
            try {
              const { jobId } = await api(`/api/instances/${inst.id}/mods/install`, {
                method: 'POST',
                body: { projectId: b.dataset.install },
              });
              closeModal();
              watchJob(jobId);
            } catch (e) {
              b.disabled = false;
              b.textContent = '安装';
              toast(e.message, 'error');
            }
          };
        });
      } catch (e) {
        results.innerHTML = `<div class="hint">搜索失败：${esc(e.message)}</div>`;
      }
    };
    root.querySelector('#msGo').onclick = doSearch;
    root.querySelector('#msQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
  });
}

function openImportPack() {
  const body = `
    <div class="field"><label>Modrinth 整合包链接（.mrpack）</label>
      <input id="ipUrl" placeholder="https://cdn.modrinth.com/data/.../pack.mrpack" />
      <div class="hint" style="margin-top:6px">会自动创建实例、装加载器、下载全部模组。CurseForge 格式暂不支持。</div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="ipCancel">取消</button>
      <button class="primary" id="ipGo">开始安装</button>
    </div>`;
  modal('导入整合包', body, (root) => {
    root.querySelector('#ipCancel').onclick = closeModal;
    root.querySelector('#ipGo').onclick = async () => {
      const url = root.querySelector('#ipUrl').value.trim();
      if (!url) return toast('请填写链接', 'error');
      try {
        const { jobId } = await api('/api/modpacks', { method: 'POST', body: { url } });
        closeModal();
        toast('开始安装整合包');
        watchJob(jobId);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

/* ---------------- 事件绑定 ---------------- */

$('#newInstanceBtn').addEventListener('click', openNewInstance);
$('#settingsBtn').addEventListener('click', openSettings);
$('#accountsBtn').addEventListener('click', openAccounts);
$('#importPackBtn').addEventListener('click', openImportPack);

$('#instanceList').addEventListener('click', (e) => {
  const btn = e.target.closest('.instance-item');
  if (!btn) return;
  state.selected = btn.dataset.id;
  localStorage.setItem('mc.selected', state.selected);
  renderSidebar();
  renderMain();
});

refresh();
setInterval(() => {
  if (state.timer) return;
  refresh();
}, 15000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
