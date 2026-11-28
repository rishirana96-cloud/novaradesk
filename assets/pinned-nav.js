(() => {
  const nav = document.querySelector('#appSidebar .test-inbox-navigation');
  if (!nav) return;
  const section = document.createElement('section');
  section.className = 'test-inbox-nav-group pinned-navigation';
  section.setAttribute('aria-label', 'Pinned navigation');
  section.innerHTML = '<h3>Pinned</h3><div class="pinned-items"></div><p class="pinned-hint">Drag menu items here to pin</p><span class="pinned-announcement" role="status" aria-live="polite"></span>';
  nav.prepend(section);
  const list = section.querySelector('.pinned-items');
  const hint = section.querySelector('.pinned-hint');
  const status = section.querySelector('[role=status]');
  let pins = [], storageKey = null, dragged = null;
  const storage = window.NOVARA_LOCAL_STORAGE || localStorage;
  const selector = '.test-inbox-nav-link';
  const keyFor = el => {
    for (const attr of ['data-inbox-page', 'data-inbox-filter', 'data-analytics-dashboard']) {
      if (el.hasAttribute(attr)) return attr + ':' + el.getAttribute(attr);
    }
    return null;
  };
  const sources = () => [...nav.querySelectorAll(selector)].filter(el => !section.contains(el));
  const find = key => sources().find(el => keyFor(el) === key);
  function save() {
    if (!storageKey) return;
    try { storage.setItem(storageKey, JSON.stringify(pins)); }
    catch { status.textContent = 'Pins could not be saved in this browser.'; }
  }
  function render() {
    list.replaceChildren();
    for (const key of pins) {
      const source = find(key);
      if (!source) continue;
      const row = document.createElement('div'); row.className = 'pinned-row'; row.dataset.pinKey = key; row.draggable = true;
      const link = document.createElement('button'); link.type = 'button'; link.className = 'test-inbox-nav-link pinned-link';
      const icon = source.querySelector('svg')?.cloneNode(true); if (icon) link.append(icon);
      const label = document.createElement('span'); label.className = 'test-inbox-nav-label'; label.textContent = source.querySelector('.test-inbox-nav-label')?.textContent || source.textContent.trim(); link.append(label);
      link.title = label.textContent;
      link.classList.toggle('active', source.classList.contains('active'));
      if (source.classList.contains('active')) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', () => source.click());
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pinned-remove'; remove.textContent = '×'; remove.title = 'Unpin ' + label.textContent; remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => { pins = pins.filter(id => id !== key); save(); render(); (list.querySelector('button') || hint).focus(); });
      row.addEventListener('keydown', event => {
        if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const index = pins.indexOf(key), next = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (next < 0 || next >= pins.length) return;
        [pins[index], pins[next]] = [pins[next], pins[index]]; save(); render();
        [...list.children].find(el => el.dataset.pinKey === key)?.querySelector('button').focus();
      });
      row.append(link, remove); list.append(row);
    }
    hint.hidden = !!list.children.length; hint.tabIndex = -1;
    sources().forEach(el => { el.draggable = true; el.title ||= 'Drag to Pinned · Alt+P to pin'; });
  }
  nav.addEventListener('dragstart', event => {
    if (!document.body.classList.contains('expanded-inbox-mode')) return;
    const row = event.target.closest('[data-pin-key]');
    const source = event.target.closest(selector);
    dragged = row?.dataset.pinKey || (source && keyFor(source));
    if (!dragged) return;
    event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('text/plain', dragged);
    section.classList.add('pin-dragging');
  });
  section.addEventListener('dragover', event => {
    if (!dragged) return; event.preventDefault(); event.dataTransfer.dropEffect = pins.includes(dragged) ? 'move' : 'copy';
    section.classList.add('pin-drop-active');
  });
  section.addEventListener('dragleave', event => { if (!section.contains(event.relatedTarget)) section.classList.remove('pin-drop-active'); });
  section.addEventListener('drop', event => {
    if (!dragged || !find(dragged)) return;
    event.preventDefault();
    const row = event.target.closest('[data-pin-key]');
    if (row?.dataset.pinKey !== dragged) {
      pins = pins.filter(key => key !== dragged);
      let index = row ? pins.indexOf(row.dataset.pinKey) : pins.length;
      if (row && event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2) index++;
      pins.splice(Math.max(0, index), 0, dragged); save(); render();
    }
    status.textContent = 'Pinned navigation updated';
    section.classList.remove('pin-dragging', 'pin-drop-active'); dragged = null;
  });
  nav.addEventListener('dragend', () => { dragged = null; section.classList.remove('pin-dragging', 'pin-drop-active'); });
  nav.addEventListener('keydown', event => {
    const source = event.target.closest(selector);
    if (!event.altKey || event.key.toLowerCase() !== 'p' || !source || section.contains(source)) return;
    const key = keyFor(source); if (!key) return; event.preventDefault();
    if (!pins.includes(key)) { pins.push(key); save(); render(); status.textContent = 'Item pinned'; }
  });
  let queued = false;
  new MutationObserver(records => {
    if (records.every(record => section.contains(record.target))) return;
    if (queued) return; queued = true;
    queueMicrotask(() => { queued = false; render(); });
  }).observe(nav, {subtree:true, childList:true, attributes:true, attributeFilter:['class']});
  window.NovaraPinnedNavigation = {
    initialize(user) {
      storageKey = 'novaradesk_pinned_v1:' + JSON.stringify([user?.workspace_id || '', user?.email || user?.id || 'preview']);
      try { const saved = JSON.parse(storage.getItem(storageKey) || '[]'); pins = Array.isArray(saved) ? [...new Set(saved.filter(key => typeof key === 'string'))] : []; } catch { pins = []; }
      render();
    }
  };
  window.NovaraPinnedNavigation.initialize(window.NOVARA_PINNED_USER);
})();
