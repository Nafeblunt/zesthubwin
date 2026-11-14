(() => {
  const host = document.getElementById('site-header');
  if (!host) return;
  host.innerHTML = `  <div class="bar hidden" id="bar">
    <nav class="bar-links" aria-label="Main navigation">
      <a class="button-link" href="/" aria-current="page">Home</a>
      <a class="button-link" href="/Forum">Forum</a>
      <a class="button-link" href="/Market">Market</a>
      <a class="button-link" href="/Chat">Chat</a>
    </nav>
    <section class="login hidden" id="login" aria-label="Account">
      <button class="login-btn" id="login-btn" type="button" title="Log in with Discord">Log in</button>
      <button class="account-btn" id="account-btn" type="button" aria-label="Open account" title="Account" hidden>
        <img id="discord-avatar" alt="" width="40" height="40" hidden>
        <svg id="avatar-fallback" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 21a7.5 7.5 0 0 1 15 0"></path></svg>
      </button>
      <p id="login-status" role="status"></p>
    </section>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', `  <dialog id="account-dialog" class="account-dialog" aria-labelledby="account-title">
    <div class="account-heading"><h2 id="account-title">Account</h2><button id="account-close" type="button" aria-label="Close account">×</button></div>
    <div class="account-layout">
      <div class="account-tabs" role="tablist" aria-label="Account sections" aria-orientation="vertical">
        <button id="account-tab-profile" type="button" role="tab" aria-selected="true" aria-controls="account-panel-profile">Account</button>
        <button id="account-tab-licence" type="button" role="tab" aria-selected="false" aria-controls="account-panel-licence" tabindex="-1">Licence</button>
      </div>
      <section id="account-panel-profile" class="account-panel" role="tabpanel" aria-labelledby="account-tab-profile">
        <p class="account-kicker">DISCORD</p>
        <p id="account-name"></p>
        <button id="logout-btn" class="button-link" type="button" hidden>Log out</button>
      </section>
      <section id="account-panel-licence" class="account-panel" role="tabpanel" aria-labelledby="account-tab-licence" hidden>
        <form id="account-licence-form">
          <label for="account-licence-key">Your licence</label>
          <input id="account-licence-key" type="text" placeholder="ZEST-XXXXXXXXXXXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="53" aria-describedby="account-licence-status" disabled>
          <div class="account-licence-actions"><button id="account-licence-link" type="submit" disabled>Redeem licence</button><button id="account-licence-copy" type="button" hidden>Copy key</button></div>
        </form>
        <dl class="account-licence-info" id="account-licence-info" hidden>
          <div><dt>Status</dt><dd id="account-licence-state"></dd></div>
          <div><dt>Duration</dt><dd id="account-licence-duration"></dd></div>
          <div><dt>Activated</dt><dd id="account-licence-activated"></dd></div>
          <div><dt>Expires</dt><dd id="account-licence-expires"></dd></div>
        </dl>
        <p id="account-licence-status" role="status"></p>
      </section>
    </div>
  </dialog>`);
  host.querySelectorAll('.bar-links a').forEach(link => {
    link.removeAttribute('aria-current');
    if (link.textContent === host.dataset.page) link.setAttribute('aria-current', 'page');
  });
  if (!document.getElementById('loader')) {
    host.querySelector('#bar').classList.remove('hidden');
    host.querySelector('#login').classList.remove('hidden');
  }
})();
