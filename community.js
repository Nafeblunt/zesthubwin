const api = 'https://login.zesthub.win';
const kind = document.body.dataset.community;
const posts = document.getElementById('posts');
const status = document.getElementById('community-status');
const compose = document.getElementById('compose');
const form = document.getElementById('post-form');
const login = document.getElementById('login-link');

login.addEventListener('click', () => window.location.assign(api + '/start'));

async function loadPosts() {
  const response = await fetch(`${api}/community/${kind}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not load posts. Please try again later.');
  const data = await response.json();
  posts.replaceChildren();
  if (!data.posts.length) {
    const empty = document.createElement('p');
    empty.className = 'community-empty';
    empty.textContent = kind === 'forum' ? 'No posts yet.' : 'No listings yet.';
    posts.append(empty);
    return;
  }
  for (const post of data.posts) {
    const article = document.createElement('article'); article.className = 'community-post';
    const heading = document.createElement('h2'); heading.textContent = post.title;
    const meta = document.createElement('p'); meta.className = 'community-meta';
    meta.textContent = `${post.author_name} · ${new Date(post.created_at * 1000).toLocaleDateString()}`;
    const body = document.createElement('p'); body.className = 'community-body'; body.textContent = post.body;
    article.append(heading, meta, body); posts.append(article);
  }
}

async function loadSession() {
  const response = await fetch(api + '/me', { credentials: 'include' });
  if (!response.ok) throw new Error('Could not check Discord login.');
  const session = await response.json();
  login.hidden = Boolean(session.user);
  document.getElementById('community-user').textContent = session.user ? `${session.user.name} | ${session.user.role || 'Member'}` : '';
  compose.hidden = !session.user || (kind === 'market' && !session.marketOwner);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; status.textContent = 'Posting…';
  try {
    const response = await fetch(`${api}/community/${kind}`, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('post-title').value, body: document.getElementById('post-body').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not post.');
    form.reset(); await loadPosts(); status.textContent = 'Posted.';
  } catch (error) { status.textContent = error.message || 'Could not post.'; }
  finally { button.disabled = false; }
});

Promise.allSettled([loadPosts(), loadSession()]).then(results => {
  const failure = results.find(result => result.status === 'rejected');
  if (failure) status.textContent = failure.reason.message || 'Please try again later.';
});
