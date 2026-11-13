function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = new Intl.DateTimeFormat("ru", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  document.getElementById("date").textContent = date[0].toLocaleUpperCase("ru") + date.slice(1);
}
updateClock();
setInterval(updateClock, 60_000);
