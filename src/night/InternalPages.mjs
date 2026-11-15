const PAGES = {
  addons: ["Расширения", "extensions"], logins: ["Пароли", "shield"], downloads: ["Загрузки", "download"],
  preferences: ["Настройки", "settings"], processes: ["Процессы", "memory"], memory: ["Память", "memory"],
  support: ["Диагностика", "settings"], config: ["Конфигурация", "code"], privatebrowsing: ["Приватное окно", "private"],
  sessionrestore: ["Восстановление вкладок", "tabs"], profiles: ["Профили", "settings"],
};

export function internalPage(uri) {
  if (/^chrome:\/\/browser\/content\/preferences\/advanced\.xhtml(?:[?#]|$)/.test(uri)) return ["Дополнительные настройки", "settings"];
  return PAGES[/^about:([a-z]+)(?:[?#]|$)/.exec(uri)?.[1]];
}
