(() => {

const loginButton = document.getElementById("login-btn");
const logoutButton = document.getElementById("logout-btn");
const discordAvatar = document.getElementById("discord-avatar");
const avatarFallback = document.getElementById("avatar-fallback");
const loginStatus = document.getElementById("login-status");
const loginService = "https://login.zesthub.win";
const downloadButton = document.getElementById("download-btn");
const buyButton = document.getElementById("buy-btn");
const accountButton = document.getElementById("account-btn");
const accountDialog = document.getElementById("account-dialog");
const accountName = document.getElementById("account-name");
const accountTabs = Array.from(document.querySelectorAll('.account-tabs [role="tab"]'));
const licenceForm = document.getElementById("account-licence-form");
const licenceInput = document.getElementById("account-licence-key");
const licenceRedeem = document.getElementById("account-licence-link");
const licenceCopy = document.getElementById("account-licence-copy");
const licenceStatus = document.getElementById("account-licence-status");
const licenceInfo = document.getElementById("account-licence-info");
let accountUserId = null;
let licenceRequest = 0;
let licenceLoaded = false;
let licenceBusy = false;

function resetLicence() {
  licenceRequest++;
  licenceLoaded = false;
  licenceBusy = false;
  licenceInput.value = "";
  licenceInput.disabled = true;
  licenceInput.readOnly = false;
  licenceRedeem.hidden = false;
  licenceRedeem.disabled = true;
  licenceRedeem.textContent = "Redeem licence";
  licenceCopy.hidden = true;
  licenceInfo.hidden = true;
  licenceStatus.textContent = "";
  licenceInfo.querySelectorAll('dd').forEach(item => { item.textContent = ""; });
}

function showLicence(licence) {
  licenceLoaded = true;
  licenceInput.disabled = false;
  licenceInput.readOnly = Boolean(licence);
  licenceInput.value = licence?.key || "";
  licenceRedeem.hidden = Boolean(licence);
  licenceRedeem.disabled = true;
  licenceCopy.hidden = !licence;
  licenceInfo.hidden = !licence;
  if (!licence) {
    licenceStatus.textContent = "Enter your key Redeeming starts the timer";
    return;
  }
  const seconds = licence.durationSeconds;
  const duration = seconds === 253402300799 ? "Lifetime" : seconds % 86400 === 0
    ? `${seconds / 86400} day${seconds === 86400 ? "" : "s"}` : seconds % 3600 === 0
    ? `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}` : `${Math.ceil(seconds / 60)} minutes`;
  const date = value => value === null ? "Not activated" : new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }).replaceAll('.', '');
  document.getElementById("account-licence-state").textContent = licence.status;
  document.getElementById("account-licence-duration").textContent = duration;
  document.getElementById("account-licence-activated").textContent = date(licence.activatedAt);
  document.getElementById("account-licence-expires").textContent = seconds === 253402300799 ? "Never" : date(licence.expiresAt);
  licenceStatus.textContent = "Saved to your account";
}

async function loadLicence() {
  if (!accountUserId || licenceLoaded || licenceBusy) return;
  licenceBusy = true;
  const request = ++licenceRequest;
  licenceStatus.textContent = "Loading your licence";
  try {
    const response = await fetch(`${loginService}/account/license`, { credentials: "include" });
    const data = await response.json();
    if (request !== licenceRequest) return;
    if (!response.ok) throw new Error(data.error || "Could not load your licence Reopen this tab to retry");
    showLicence(data.license);
  } catch (error) {
    if (request === licenceRequest) licenceStatus.textContent = error.message || "Could not load your licence Reopen this tab to retry";
  } finally { if (request === licenceRequest) licenceBusy = false; }
}

function selectAccountTab(tab) {
  accountTabs.forEach(item => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
  });
  if (tab.id === "account-tab-licence") loadLicence();
}
accountTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectAccountTab(tab));
  tab.addEventListener("keydown", event => {
    let next;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") next = accountTabs[(index + (event.key === "ArrowDown" ? 1 : -1) + accountTabs.length) % accountTabs.length];
    if (event.key === "Home") next = accountTabs[0];
    if (event.key === "End") next = accountTabs[accountTabs.length - 1];
    if (!next) return;
    event.preventDefault(); next.focus(); selectAccountTab(next);
  });
});
accountDialog.addEventListener("close", resetLicence);
licenceInput.addEventListener("input", () => { licenceRedeem.disabled = licenceBusy || !licenceInput.value.trim(); });
licenceForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!accountUserId || licenceBusy || licenceInput.readOnly || !licenceInput.value.trim()) return;
  licenceBusy = true;
  const request = ++licenceRequest;
  licenceInput.readOnly = true;
  licenceRedeem.disabled = true;
  licenceRedeem.textContent = "Redeeming";
  licenceStatus.textContent = "";
  try {
    const response = await fetch(`${loginService}/account/license`, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: licenceInput.value.trim() }) });
    const data = await response.json();
    if (request !== licenceRequest) return;
    if (!response.ok) throw new Error(data.error || "Could not redeem that licence Please try again");
    showLicence(data.license);
  } catch (error) {
    if (request === licenceRequest) {
      licenceInput.readOnly = false;
      licenceRedeem.disabled = !licenceInput.value.trim();
      licenceStatus.textContent = error.message || "Could not redeem that licence Please try again";
    }
  } finally {
    if (request === licenceRequest) { licenceBusy = false; licenceRedeem.textContent = "Redeem licence"; }
  }
});
licenceCopy.addEventListener("click", async () => {
  const request = licenceRequest;
  try {
    await navigator.clipboard.writeText(licenceInput.value);
    if (request === licenceRequest) licenceStatus.textContent = "Licence key copied";
  } catch { if (request === licenceRequest) licenceStatus.textContent = "Select the key and copy it manually"; }
});

discordAvatar.addEventListener("error", () => {
  discordAvatar.hidden = true;
  avatarFallback.hidden = false;
});

accountButton.addEventListener("click", () => { selectAccountTab(accountTabs[0]); accountDialog.showModal(); });
document.getElementById("account-close").addEventListener("click", () => accountDialog.close());

downloadButton?.addEventListener("click", () => {
  window.location.assign(`${loginService}/download-loader`);
});

loginButton.addEventListener("click", () => {
  const page = ['Forum', 'Market', 'Chat'].find(name => window.location.pathname.split('/')[1] === name);
  window.location.assign(`${loginService}/start${page ? '?next=' + encodeURIComponent('/' + page) : ''}`);
});

async function updateLogin() {
  try {
    const response = await fetch(`${loginService}/me`, { credentials: "include" });
    if (!response.ok) throw new Error("Login unavailable");
    const { user, buyer, shoutboxWriter, marketOwner } = await response.json();
    if (accountUserId !== (user?.id || null)) resetLicence();
    accountUserId = user?.id || null;
    window.dispatchEvent(new CustomEvent("zest:session", { detail: { user, shoutboxWriter, marketOwner } }));
    discordAvatar.hidden = !user?.avatarUrl;
    avatarFallback.hidden = Boolean(user?.avatarUrl);
    if (user?.avatarUrl) discordAvatar.src = user.avatarUrl;
    else discordAvatar.removeAttribute("src");
    accountButton.hidden = !user;
    accountName.textContent = user?.name || "";
    if (!user && accountDialog.open) accountDialog.close();
    logoutButton.hidden = !user;
    loginButton.hidden = Boolean(user);
    if (downloadButton) downloadButton.hidden = !buyer;
    if (buyButton) buyButton.hidden = Boolean(buyer);
    loginStatus.textContent = "";
  } catch {
    accountUserId = null;
    resetLicence();
    window.dispatchEvent(new CustomEvent("zest:session", { detail: { user: null } }));
    accountButton.hidden = true;
    if (accountDialog.open) accountDialog.close();
    if (downloadButton) downloadButton.hidden = true;
    if (buyButton) buyButton.hidden = false;
    loginStatus.textContent = "Could not check Discord access Please try again later";
  }
}

logoutButton.addEventListener("click", async () => {
  try {
    const response = await fetch(`${loginService}/logout`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Logout failed");
    await updateLogin();
  } catch {
    loginStatus.textContent = "Could not log out Please try again";
  }
});

if (new URLSearchParams(window.location.search).get("login") === "failed") {
  loginStatus.textContent = "Discord login was cancelled or failed Please try again";
  window.history.replaceState({}, "", window.location.pathname);
}
updateLogin();

document.querySelectorAll('.button-link, #account-panel-profile button').forEach(button => {
  button.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = button.getBoundingClientRect();
    if (!bounds.width) return;
    const position = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    button.style.setProperty('--hover-tilt', `${position * 6}deg`);
  });
  button.addEventListener('pointerleave', () => button.style.removeProperty('--hover-tilt'));
});

})();
