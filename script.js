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