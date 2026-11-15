(() => {
  const chat = document.getElementById('chat');
  if (!chat) return;
  const publicChat = chat.dataset.room === 'community';
  const api = `https://login.zesthub.win/${publicChat ? 'chat' : 'shoutbox'}`;
  const messages = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const count = document.getElementById('chat-count');
  const status = document.getElementById('chat-status');
  const send = form.querySelector('button[type="submit"]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let user = null;
  let shoutboxWriter = false;
  let sending = false;
  let loading = false;
  let loaded = false;
  let timer;
  let requestVersion = 0;
  let mutedUntil = 0;
  const rowData = new Map();
  const menu = document.createElement('div');
  menu.id = 'chat-user-menu';
  menu.className = 'chat-user-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Message actions');
  menu.innerHTML = `<p class="chat-menu-name"></p>
    <label class="chat-mute-duration">Mute for <select aria-label="Mute duration"><option value="600">10 minutes</option><option value="3600" selected>1 hour</option><option value="86400">24 hours</option></select></label>
    <button type="button" data-action="mute">Mute</button>
    <button type="button" data-action="remove">Remove message</button>
    <p class="chat-menu-status" role="status"></p>`;
  document.body.append(menu);
  const menuName = menu.querySelector('.chat-menu-name');
  const menuStatus = menu.querySelector('.chat-menu-status');
  const muteButton = menu.querySelector('[data-action="mute"]');
  const removeButton = menu.querySelector('[data-action="remove"]');
  const duration = menu.querySelector('select');
  let menuAnchor = null;
  let selectedId = null;
  let moderating = false;

  function closeMenu() {
    if (menu.matches(':popover-open')) menu.hidePopover();
  }
  function updateNameButtons() {
    messages.querySelectorAll('.chat-name').forEach(button => {
      button.disabled = !shoutboxWriter;
      if (shoutboxWriter) button.setAttribute('aria-haspopup', 'dialog');
      else button.removeAttribute('aria-haspopup');
    });
  }
  function updateMenu() {
    const row = rowData.get(selectedId);
    if (!row) { closeMenu(); return; }
    const muted = row.author_muted_until > Date.now() / 1000;
    menuName.textContent = row.author_name;
    muteButton.textContent = muted ? 'Unmute' : 'Mute';
    muteButton.disabled = moderating || row.author_id === user?.id;
    removeButton.disabled = moderating;
    duration.disabled = moderating;
    duration.parentElement.hidden = muted || row.author_id === user?.id;
  }
  messages.addEventListener('click', event => {
    const button = event.target.closest('.chat-name');
    if (!button || !shoutboxWriter) return;
    const id = button.closest('[data-message-id]').dataset.messageId;
    if (menuAnchor === button && menu.matches(':popover-open')) { closeMenu(); return; }
    closeMenu();
    selectedId = id;
    menuAnchor = button;
    menuStatus.textContent = '';
    updateMenu();
    menu.showPopover();
    const bounds = button.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - box.width - 8));
    const top = bounds.bottom + box.height + 8 <= window.innerHeight
      ? bounds.bottom + 6 : Math.max(8, bounds.top - box.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    button.setAttribute('aria-expanded', 'true');
  });
  menu.addEventListener('toggle', event => {
    if (event.newState === 'closed') menuAnchor?.setAttribute('aria-expanded', 'false');
  });
  messages.addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, { passive: true });
  menu.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    const row = rowData.get(selectedId);
    if (!button || !row || !shoutboxWriter || moderating) return;
    const removing = button.dataset.action === 'remove';
    const unmuting = row.author_muted_until > Date.now() / 1000;
    const id = selectedId;
    moderating = true;
    updateMenu();
    menuStatus.textContent = '';
    try {
      const response = await fetch(`${api}/${id}${removing ? '' : '/mute'}`, {
        method: removing || unmuting ? 'DELETE' : 'POST', credentials: 'include',
        ...(!removing && !unmuting ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration: Number(duration.value) }) } : {})
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { shoutboxWriter = false; updateNameButtons(); closeMenu(); }
        throw new Error(data.error || 'Could not save that change');
      }
      requestVersion++;
      if (removing) {
        closeMenu();
        render(Array.from(rowData.values()).filter(message => message.id !== id));
      } else {
        for (const message of rowData.values()) if (message.author_id === row.author_id) message.author_muted_until = data.mutedUntil;
        menuStatus.textContent = unmuting ? 'Unmuted' : 'Muted';
      }
    } catch (error) { menuStatus.textContent = error.message || 'Could not save that change'; }
    finally { moderating = false; if (selectedId === id) updateMenu(); }
  });

  function updateComposer() {
    const canSend = Boolean(user) && (publicChat || shoutboxWriter);
    const muted = mutedUntil > Date.now() / 1000;
    form.hidden = !canSend || muted;
    input.disabled = !canSend || muted;
    input.readOnly = sending;
    input.placeholder = user ? 'Message' : 'Log in to chat';
    send.disabled = !canSend || muted || sending || !input.value.trim();
    send.textContent = sending ? 'Sending' : 'Send';
    count.textContent = `${input.value.length}/280`;
    if (muted) {
      status.textContent = `Muted until ${new Date(mutedUntil * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      status.dataset.muted = 'true';
    } else if (status.dataset.muted) {
      status.textContent = '';
      delete status.dataset.muted;
    }
  }

  function render(rows, ownMessage = false) {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 64;
    const existing = new Map(Array.from(messages.querySelectorAll('[data-message-id]'), row => [row.dataset.messageId, row]));
    const ids = new Set(rows.map(row => row.id));
    for (const id of rowData.keys()) if (!ids.has(id)) rowData.delete(id);
    for (const row of rows) if (row.author_id) rowData.set(row.id, row);
    if (menu.matches(':popover-open') && !ids.has(selectedId)) closeMenu();
    if (!rows.length) {
      if (!messages.querySelector('.chat-empty') || !loaded) {
        const empty = document.createElement('p');
        empty.className = 'chat-empty';
        empty.textContent = 'No messages yet';
        messages.replaceChildren(empty);
      }
      loaded = true;
      return;
    }
    messages.querySelector('.chat-empty')?.remove();
    const keep = new Set(rows.map(row => row.id));
    for (const [id, node] of existing) if (!keep.has(id)) node.remove();
    for (const row of rows) {
      if (existing.has(row.id)) continue;
      const article = document.createElement('article');
      article.className = 'chat-message';
      article.dataset.messageId = row.id;
      if (loaded) article.classList.add('chat-message-new');
      const avatar = document.createElement('span');
      avatar.className = 'chat-avatar';
      avatar.textContent = (row.author_name || '?').slice(0, 1).toUpperCase();
      if (typeof row.author_avatar === 'string' && /^https:\/\/cdn\.discordapp\.com\//.test(row.author_avatar)) {
        const image = document.createElement('img');
        image.src = row.author_avatar;
        image.alt = '';
        image.width = image.height = 32;
        image.addEventListener('error', () => image.remove(), { once: true });
        avatar.append(image);
      }
      const line = document.createElement('p');
      line.className = 'chat-line';
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'chat-name';
      name.disabled = !shoutboxWriter;
      name.setAttribute('aria-controls', 'chat-user-menu');
      name.textContent = row.author_name;
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = row.body;
      line.append(name, document.createTextNode(': '), text);
      const time = document.createElement('time');
      const date = new Date(row.created_at * 1000);
      time.dateTime = date.toISOString();
      time.title = date.toLocaleString();
      time.textContent = zestTimeAgo(row.created_at);
      article.append(avatar, line, time);
      messages.append(article);
    }
    if (!loaded || nearBottom || ownMessage) messages.scrollTo({ top: messages.scrollHeight,
      behavior: loaded && !reducedMotion.matches ? 'smooth' : 'instant' });
    loaded = true;
    updateNameButtons();
    if (menu.matches(':popover-open')) updateMenu();
  }

  async function loadMessages() {
    if (loading || document.hidden) return;
    messages.querySelectorAll('time[datetime]').forEach(time => {
      time.textContent = zestTimeAgo(Date.parse(time.dateTime) / 1000);
    });
    loading = true;
    const version = requestVersion;
    try {
      const response = await fetch(api, { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load chat Retrying shortly');
      const data = await response.json();
      if (version !== requestVersion) return;
      const wasMuted = mutedUntil > Date.now() / 1000;
      mutedUntil = data.mutedUntil || 0;
      if (wasMuted && !mutedUntil) status.textContent = '';
      render(data.messages);
      updateComposer();
      if (status.dataset.error === 'load') {
        status.textContent = publicChat && !user ? 'Log in to chat' : '';
        delete status.dataset.error;
      }
    } catch (error) {
      if (version !== requestVersion) return;
      status.textContent = error.message || 'Could not load chat Retrying shortly';
      status.dataset.error = 'load';
      if (!loaded) messages.querySelector('.chat-empty').textContent = 'Chat is temporarily unavailable';
    } finally { loading = false; }
  }

  window.addEventListener('zest:session', event => {
    user = event.detail?.user || null;
    shoutboxWriter = event.detail?.shoutboxWriter === true;
    status.textContent = publicChat && !user ? 'Log in to chat' : '';
    delete status.dataset.error;
    updateComposer();
    updateNameButtons();
    closeMenu();
  });
  input.addEventListener('input', updateComposer);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = input.value.trim();
    if (!user || mutedUntil > Date.now() / 1000 || (!publicChat && !shoutboxWriter) || sending || !body || body.length > 280) return;
    sending = true;
    updateComposer();
    status.textContent = '';
    delete status.dataset.error;
    try {
      const response = await fetch(api, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) user = null;
        if (data.mutedUntil) mutedUntil = data.mutedUntil;
        else if (response.status === 403 && !publicChat) shoutboxWriter = false;
        throw new Error(data.error || 'Could not send your message Please try again');
      }
      requestVersion++;
      // Keep existing nodes so refreshing never replays the whole conversation.
      const row = data.message;
      const current = Array.from(messages.querySelectorAll('[data-message-id]'), node => ({ id: node.dataset.messageId }));
      render([...current, row].slice(-100), true);
      input.value = '';
      input.focus();
    } catch (error) { status.textContent = error.message || 'Could not send your message Please try again'; }
    finally { sending = false; updateComposer(); }
  });

  function startPolling() {
    clearInterval(timer);
    if (document.hidden) return;
    loadMessages();
    timer = setInterval(loadMessages, 5000);
  }
  document.addEventListener('visibilitychange', startPolling);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', startPolling);
  updateComposer();
  startPolling();
})();
