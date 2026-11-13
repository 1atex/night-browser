function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = new Intl.DateTimeFormat("ru", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  document.getElementById("date").textContent = new Intl.DateTimeFormat("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const hour = now.getHours();
  document.getElementById("greeting").textContent =
    hour < 6
      ? "Весь мир может подождать."
      : hour < 12
        ? "Новый день. Свой ритм."
        : hour < 18
          ? "Место для твоих идей."
          : "Вечер в твоём ритме.";
}
updateClock();
setInterval(updateClock, 60_000);
