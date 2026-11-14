const clockFormat = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("ru", { weekday: "long", day: "numeric", month: "long" });
let clockTimer = null;

function stopClock() {
  clearTimeout(clockTimer);
  clockTimer = null;
}

function updateClock() {
  stopClock();
  if (document.hidden) return;
  const now = new Date();
  document.getElementById("clock").textContent = clockFormat.format(now);
  const date = dateFormat.format(now);
  document.getElementById("date").textContent = date[0].toLocaleUpperCase("ru") + date.slice(1);
  clockTimer = setTimeout(updateClock, 60_000 - now.getTime() % 60_000);
}

document.addEventListener("visibilitychange", updateClock);
window.addEventListener("pagehide", stopClock);
window.addEventListener("pageshow", updateClock);
updateClock();
