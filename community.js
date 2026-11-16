(() => {
const api = 'https://login.zesthub.win';
const kind = document.body.dataset.community;
const posts = document.getElementById('posts');
const status = document.getElementById('community-status');
const compose = document.getElementById('compose');
const form = document.getElementById('post-form');
const postBody = document.getElementById('post-body');
const postCount = document.getElementById('post-count');
let currentSession = null;
let cachedPosts = [];


async function loadPosts() {
  const response = await fetch(`${api}/community/${kind}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not load posts Please try again later');
  const data = await response.json();
  cachedPosts = data.posts;
  renderPosts();
}

function renderPosts() {
  posts.replaceChildren();
  if (!cachedPosts.length) {
    const empty = document.createElement('p');
    empty.className = 'community-empty';
    empty.textContent = kind === 'forum' ? 'No posts yet' : 'No listings yet';
    posts.append(empty);
    return;
  }
  for (const post of cachedPosts) {
    const article = document.createElement('article'); article.className = 'community-post';
    const heading = document.createElement('h3'); heading.textContent = post.title;
    const meta = document.createElement('p'); meta.className = 'community-meta';
    const time = document.createElement('time');
    const date = new Date(post.created_at * 1000);
    time.dateTime = date.toISOString();
    time.title = date.toLocaleString();
    time.textContent = zestTimeAgo(post.created_at);
    meta.append(document.createTextNode(`${post.author_name} · `), time);
    const body = document.createElement('p'); body.className = 'community-body'; body.textContent = post.body;
    article.append(heading, meta, body);
    if (currentSession?.user && (currentSession.marketOwner || currentSession.user.id === post.author_id)) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'community-delete'; remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this post?')) return;
        remove.disabled = true;
        try {
          const response = await fetch(`${api}/community/${kind}/${post.id}`, { method: 'DELETE', credentials: 'include' });
          if (!response.ok) throw new Error('Could not delete this post');
          await loadPosts(); status.textContent = 'Deleted';
        } catch (error) { status.textContent = error.message; remove.disabled = false; }
      });
      article.append(remove);
    }
    posts.append(article);
  }
}

postBody.addEventListener('input', () => { postCount.textContent = `${postBody.value.length}/4000`; });

window.addEventListener('zest:session', event => {
  currentSession = event.detail;
  compose.hidden = !currentSession?.user || (kind === 'market' && !currentSession.marketOwner);
  renderPosts();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; status.textContent = 'Posting';
  try {
    const response = await fetch(`${api}/community/${kind}`, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('post-title').value, body: document.getElementById('post-body').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not post');
    form.reset(); postCount.textContent = '0/4000'; await loadPosts(); status.textContent = 'Posted';
  } catch (error) { status.textContent = error.message || 'Could not post'; }
  finally { button.disabled = false; }
});

loadPosts().catch(error => {
  const failed = document.createElement('p');
  failed.className = 'community-empty';
  failed.textContent = error.message || 'Could not load posts';
  posts.replaceChildren(failed);
});
setInterval(() => {
  if (document.hidden) return;
  posts.querySelectorAll('time[datetime]').forEach(time => {
    time.textContent = zestTimeAgo(Date.parse(time.dateTime) / 1000);
  });
}, 60000);

})();
