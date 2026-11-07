const MESSAGE = "Welcome to Zest Hub";
const TYPE_SPEED = 90;
const HOLD_TIME = 1200;

const loader = document.getElementById("loader");
const hero = document.getElementById("hero");
const login = document.getElementById("login");
const typewriter = document.getElementById("typewriter");

function typeLetter(i) {
  if (i <= MESSAGE.length) {
    typewriter.textContent = MESSAGE.slice(0, i);
    setTimeout(() => typeLetter(i + 1), TYPE_SPEED);
  } else {
    setTimeout(() => {
      loader.classList.add("fade-out");
      setTimeout(() => {
        loader.style.display = "none";
        hero.classList.remove("hidden");
        login.classList.remove("hidden");
      }, 600);
    }, HOLD_TIME);
  }
}

typeLetter(1);

const loginButton = document.getElementById("login-btn");
const logoutButton = document.getElementById("logout-btn");
const discordUser = document.getElementById("discord-user");
const loginStatus = document.getElementById("login-status");
const loginService = "https://login.zesthub.win";

loginButton.addEventListener("click", () => {
  window.location.assign(`${loginService}/start`);
});

async function updateLogin() {
  try {
    const response = await fetch(`${loginService}/me`, { credentials: "include" });
    if (!response.ok) throw new Error("Login unavailable");
    const { user } = await response.json();
    discordUser.textContent = user ? `Signed in as ${user.name}` : "";
    discordUser.hidden = !user;
    logoutButton.hidden = !user;
    loginButton.hidden = Boolean(user);
  } catch {
    loginStatus.textContent = "Discord login is temporarily unavailable.";
  }
}

logoutButton.addEventListener("click", async () => {
  try {
    const response = await fetch(`${loginService}/logout`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Logout failed");
    await updateLogin();
  } catch {
    loginStatus.textContent = "Could not log out. Please try again.";
  }
});

if (new URLSearchParams(window.location.search).get("login") === "failed") {
  loginStatus.textContent = "Discord login was cancelled or failed. Please try again.";
  window.history.replaceState({}, "", window.location.pathname);
}
updateLogin();

document.querySelectorAll("button, .button-link").forEach((button) => {
  button.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const bounds = button.getBoundingClientRect();
    if (!bounds.width) return;
    const position = (event.clientX - bounds.left) / bounds.width;
    const tilt = Math.max(-1, Math.min(1, position * 2 - 1)) * 6;
    button.style.setProperty("--hover-tilt", `${tilt}deg`);
  });

  button.addEventListener("pointerleave", () => {
    button.style.removeProperty("--hover-tilt");
  });
});
