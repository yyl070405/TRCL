/* 触屏 HUD：按钮可拖动、可缩放，点击发送按键；空白处拖动发送视角。 */
(function () {
  const DEFAULT_BUTTONS = [
    { id: 'forward', label: 'W', x: 16, y: 54, size: 58 },
    { id: 'left', label: 'A', x: 7, y: 64, size: 58 },
    { id: 'back', label: 'S', x: 16, y: 74, size: 58 },
    { id: 'right', label: 'D', x: 25, y: 64, size: 58 },
    { id: 'jump', label: '跳', x: 84, y: 62, size: 62 },
    { id: 'sneak', label: '潜', x: 72, y: 73, size: 54 },
    { id: 'sprint', label: '跑', x: 91, y: 74, size: 54 },
    { id: 'inventory', label: '包', x: 73, y: 53, size: 50 },
    { id: 'chat', label: '聊', x: 82, y: 48, size: 46 },
    { id: 'pause', label: 'III', x: 92, y: 46, size: 44 },
  ];

  let root = null;
  let instanceId = null;
  let buttons = [];
  let editing = false;
  let screenTimer = null;
  let lookState = null;
  let lastLook = 0;

  function key(instanceId, name, action) {
    fetch(`/api/instances/${instanceId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: name, action }),
    }).catch(() => {});
  }

  function sendLook(dx, dy) {
    const now = performance.now();
    if (now - lastLook < 45) return;
    lastLook = now;
    fetch(`/api/instances/${instanceId}/look`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dx, dy }),
    }).catch(() => {});
  }

  function loadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem('mc.hud.' + instanceId) || 'null');
      if (saved && Array.isArray(saved.buttons) && saved.buttons.length) return saved;
    } catch {
      /* ignore */
    }
    return { buttons: DEFAULT_BUTTONS.map((b) => ({ ...b })) };
  }

  function saveLayout() {
    localStorage.setItem('mc.hud.' + instanceId, JSON.stringify({ buttons }));
  }

  function applyButton(el, b) {
    el.style.left = b.x + '%';
    el.style.top = b.y + '%';
    el.style.width = b.size + 'px';
    el.style.height = b.size + 'px';
    el.style.fontSize = Math.round(b.size * 0.3) + 'px';
  }

  function build() {
    root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-toolbar">
        <button id="hudEdit">编辑布局</button>
        <button id="hudReset">重置</button>
        <label class="hud-size">大小 <input id="hudSize" type="range" min="36" max="96" step="2" value="58"></label>
        <button id="hudClose">退出</button>
      </div>
      <div class="hud-screen-wrap">
        <img id="hudScreen" alt="" />
        <div id="hudHint">等待游戏画面…</div>
      </div>
      <div id="hudLook" class="hud-look"></div>
      <div id="hudButtons"></div>
    `;
    document.body.appendChild(root);

    const wrap = root.querySelector('#hudButtons');
    for (const b of buttons) {
      const el = document.createElement('div');
      el.className = 'hud-btn';
      el.textContent = b.label;
      el.dataset.id = b.id;
      applyButton(el, b);
      bindButton(el, b);
      wrap.appendChild(el);
    }

    root.querySelector('#hudClose').onclick = close;
    root.querySelector('#hudEdit').onclick = () => {
      editing = !editing;
      root.classList.toggle('editing', editing);
      root.querySelector('#hudEdit').textContent = editing ? '完成编辑' : '编辑布局';
    };
    root.querySelector('#hudReset').onclick = () => {
      buttons = DEFAULT_BUTTONS.map((x) => ({ ...x }));
      saveLayout();
      root.querySelector('#hudButtons').innerHTML = '';
      for (const b of buttons) {
        const el = document.createElement('div');
        el.className = 'hud-btn';
        el.textContent = b.label;
        applyButton(el, b);
        bindButton(el, b);
        root.querySelector('#hudButtons').appendChild(el);
      }
    };
    root.querySelector('#hudSize').oninput = (e) => {
      const size = Number(e.target.value);
      for (const b of buttons) b.size = size;
      for (const el of root.querySelectorAll('.hud-btn')) {
        applyButton(el, buttons.find((x) => x.id === el.dataset.id));
      }
      saveLayout();
    };

    const lookEl = root.querySelector('#hudLook');
    lookEl.addEventListener('pointerdown', (e) => {
      if (editing) return;
      lookEl.setPointerCapture(e.pointerId);
      lookState = { x: e.clientX, y: e.clientY };
    });
    lookEl.addEventListener('pointermove', (e) => {
      if (editing || !lookState) return;
      const dx = (e.clientX - lookState.x) * 1.6;
      const dy = (e.clientY - lookState.y) * 1.6;
      lookState = { x: e.clientX, y: e.clientY };
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) sendLook(dx, dy);
    });
    const endLook = () => (lookState = null);
    lookEl.addEventListener('pointerup', endLook);
    lookEl.addEventListener('pointercancel', endLook);
    lookEl.addEventListener('pointerleave', endLook);
  }

  function bindButton(el, b) {
    let dragging = false;
    let offset = { x: 0, y: 0 };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editing) {
        dragging = true;
        const rect = root.getBoundingClientRect();
        offset = { x: e.clientX - rect.left - (b.x / 100) * rect.width, y: e.clientY - rect.top - (b.y / 100) * rect.height };
        el.setPointerCapture(e.pointerId);
      } else {
        el.classList.add('pressed');
        key(instanceId, b.id, 'down');
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || !editing) return;
      const rect = root.getBoundingClientRect();
      b.x = Math.max(2, Math.min(98, ((e.clientX - rect.left - offset.x) / rect.width) * 100));
      b.y = Math.max(8, Math.min(96, ((e.clientY - rect.top - offset.y) / rect.height) * 100));
      applyButton(el, b);
    });

    const release = () => {
      if (dragging) {
        dragging = false;
        saveLayout();
      }
      if (el.classList.contains('pressed')) {
        el.classList.remove('pressed');
        key(instanceId, b.id, 'up');
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', () => {
      if (!editing) release();
    });
  }

  function startScreen() {
    const img = root.querySelector('#hudScreen');
    const hint = root.querySelector('#hudHint');
    const tick = () => {
      img.src = `/api/screen?t=${Date.now()}`;
    };
    img.onload = () => hint.classList.add('hidden');
    img.onerror = () => hint.classList.remove('hidden');
    tick();
    screenTimer = setInterval(tick, 700);
  }

  function close() {
    clearInterval(screenTimer);
    screenTimer = null;
    root?.remove();
    root = null;
    document.body.classList.remove('hud-open');
  }

  window.openHud = function (id) {
    if (root) close();
    instanceId = id;
    buttons = loadLayout().buttons;
    editing = false;
    build();
    startScreen();
    document.body.classList.add('hud-open');
  };
})();
