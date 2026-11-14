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

  function updateComposer() {
    const canSend = Boolean(user) && (publicChat || shoutboxWriter);
    form.hidden = !canSend;
    input.disabled = !canSend;
    input.readOnly = sending;
    input.placeholder = user ? 'Say something…' : 'Sign in with Discord to chat';
    send.disabled = !canSend || sending || !input.value.trim();
    send.textContent = sending ? 'Sending…' : 'Send ↗';
    count.textContent = `${input.value.length}/280`;
  }

  function render(rows, ownMessage = false) {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 64;
    const existing = new Map(Array.from(messages.querySelectorAll('[data-message-id]'), row => [row.dataset.messageId, row]));
    if (!rows.length) {
      if (!messages.querySelector('.chat-empty') || !loaded) {
        const empty = document.createElement('p');
        empty.className = 'chat-empty';
        empty.textContent = publicChat ? 'No messages yet. Start the conversation.' : 'No team updates yet.';
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
      const name = document.createElement('strong');
      name.className = 'chat-name';
      name.textContent = row.author_name;
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = row.body;
      line.append(name, document.createTextNode(': '), text);
      const time = document.createElement('time');
      const date = new Date(row.created_at * 1000);
      time.dateTime = date.toISOString();
      time.title = date.toLocaleString();
      time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      article.append(avatar, line, time);
      messages.append(article);
    }
    if (!loaded || nearBottom || ownMessage) messages.scrollTo({ top: messages.scrollHeight,
      behavior: loaded && !reducedMotion.matches ? 'smooth' : 'instant' });
    loaded = true;
  }

  async function loadMessages() {
    if (loading || document.hidden) return;
    loading = true;
    const version = requestVersion;
    try {
      const response = await fetch(api, { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load chat. Retrying shortly.');
      const data = await response.json();
      if (version !== requestVersion) return;
      render(data.messages);
      if (status.dataset.error === 'load') {
        status.textContent = publicChat && !user ? 'Sign in with Discord to join the conversation.' : '';
        delete status.dataset.error;
      }
    } catch (error) {
      if (version !== requestVersion) return;
      status.textContent = error.message || 'Could not load chat. Retrying shortly.';
      status.dataset.error = 'load';
      if (!loaded) messages.querySelector('.chat-empty').textContent = 'Chat is temporarily unavailable.';
    } finally { loading = false; }
  }

  window.addEventListener('zest:session', event => {
    user = event.detail?.user || null;
    shoutboxWriter = event.detail?.shoutboxWriter === true;
    status.textContent = publicChat && !user ? 'Sign in with Discord to join the conversation.' : '';
    delete status.dataset.error;
    updateComposer();
  });
  input.addEventListener('input', updateComposer);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = input.value.trim();
    if (!user || (!publicChat && !shoutboxWriter) || sending || !body || body.length > 280) return;
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
        if (response.status === 403 && !publicChat) shoutboxWriter = false;
        throw new Error(data.error || 'Could not send your message. Please try again.');
      }
      requestVersion++;
      // Keep existing nodes so refreshing never replays the whole conversation.
      const row = data.message;
      const current = Array.from(messages.querySelectorAll('[data-message-id]'), node => ({ id: node.dataset.messageId }));
      render([...current, row].slice(-100), true);
      input.value = '';
      input.focus();
    } catch (error) { status.textContent = error.message || 'Could not send your message. Please try again.'; }
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
  if (publicChat) {
    const login = document.getElementById('chat-login');
    login.addEventListener('click', () => window.location.assign('https://login.zesthub.win/start?next=%2FChat'));
    fetch('https://login.zesthub.win/me', { credentials: 'include' }).then(async response => {
      if (!response.ok) throw new Error('Could not check Discord login. Please reload to try again.');
      const session = await response.json();
      login.hidden = Boolean(session.user);
      document.getElementById('chat-user').textContent = session.user ? session.user.name : '';
      window.dispatchEvent(new CustomEvent('zest:session', { detail: session }));
    }).catch(() => { status.textContent = 'Could not check Discord login. Please reload to try again.'; });
  }
  updateComposer();
  startPolling();
})();
