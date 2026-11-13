window.addEventListener(
  "DOMContentLoaded",
  () => {
    const { parseSiteRules } = ChromeUtils.importESModule(
      "resource:///modules/night/MemoryPolicy.mjs",
    );
    const XHTML = "http://www.w3.org/1999/xhtml";
    const browserWindow = window.browsingContext.topChromeWindow;
    const updateTheme = () => {
      document.documentElement.setAttribute(
        "data-palette",
        Services.prefs.getStringPref("night.ui.palette", "graphite"),
      );
      document.documentElement.toggleAttribute(
        "data-motion",
        Services.prefs.getBoolPref("night.ui.animations", true),
      );
    };
    Services.prefs.addObserver("night.ui.", updateTheme);
    window.addEventListener(
      "unload",
      () => Services.prefs.removeObserver("night.ui.", updateTheme),
      { once: true },
    );
    updateTheme();
    const sections = {
      appearance: ["Внешний вид", "Цвета, панели и анимации.", "appearance"],
      tabs: [
        "Вкладки и запуск",
        "Запуск, вкладки и сочетания клавиш.",
        "tabs",
      ],
      memory: [
        "Память",
        "Выгрузка неактивных страниц и исключения.",
        "memory",
      ],
      privacy: [
        "Приватность",
        "Защита, пароли и разрешения сайтов.",
        "shield",
      ],
      search: ["Поиск", "Поисковая система и подсказки.", "search"],
      import: [
        "Импорт из Zen",
        "Перенос данных с резервной копией.",
        "import",
      ],
      about: ["О браузере", "Версия, обновления и лицензии.", "moon"],
    };
    const element = (tag, text = "", attributes = {}) => {
      const node = document.createElementNS(XHTML, tag);
      node.textContent = text;
      for (const [key, value] of Object.entries(attributes))
        node.setAttribute(key, value);
      return node;
    };
    const status = (message) => {
      document.getElementById("status").textContent = message;
    };
    const button = (text, action, className = "button") => {
      const node = element("button", text, {
        type: "button",
        class: className,
      });
      node.addEventListener("click", async () => {
        try {
          await action();
        } catch (error) {
          status(error.message);
        }
      });
      return node;
    };
    const card = (title, caption = "") => {
      const section = element("section", "", { class: "card" });
      if (title) section.append(element("h2", title));
      if (caption)
        section.append(element("p", caption, { class: "card-caption" }));
      document.getElementById("content").append(section);
      return section;
    };
    const row = (parent, title, description, control) => {
      const node = element("div", "", { class: "setting-row" });
      const label = element("div", "", { class: "setting-label" });
      label.append(element("strong", title), element("p", description));
      if (control) {
        control.setAttribute("aria-label", title);
        node.append(label, control);
      } else node.append(label);
      parent.append(node);
      return node;
    };
    function toggle(parent, title, description, pref, fallback = false) {
      const control = element("input", "", {
        type: "checkbox",
        class: "switch",
        "data-pref": pref,
      });
      control.checked = Services.prefs.getBoolPref(pref, fallback);
      control.addEventListener("change", () => {
        Services.prefs.setBoolPref(pref, control.checked);
        status("Сохранено");
      });
      row(parent, title, description, control);
      return control;
    }
    function choice(
      parent,
      title,
      description,
      pref,
      values,
      fallback,
      integer = false,
    ) {
      const select = element("select", "", { "data-pref": pref });
      select.append(
        ...values.map(([value, name]) => element("option", name, { value })),
      );
      select.value = integer
        ? Services.prefs.getIntPref(pref, fallback)
        : Services.prefs.getStringPref(pref, fallback);
      select.addEventListener("change", () => {
        if (integer) Services.prefs.setIntPref(pref, Number(select.value));
        else Services.prefs.setStringPref(pref, select.value);
        status("Сохранено");
      });
      row(parent, title, description, select);
    }
    function appearance() {
      const themes = card("Палитра");
      const grid = element("div", "", { class: "theme-grid" });
      const selected = Services.prefs.getStringPref(
        "night.ui.palette",
        "graphite",
      );
      for (const [key, label] of [
        ["graphite", "Графит"],
        ["midnight", "Полночь"],
        ["mist", "Туман"],
      ]) {
        const swatch = button(
          "",
          () => {
            Services.prefs.setStringPref("night.ui.palette", key);
            grid
              .querySelectorAll("button")
              .forEach((node) =>
                node.setAttribute("aria-pressed", String(node === swatch)),
              );
            status("Палитра изменена");
          },
          "theme-choice",
        );
        swatch.setAttribute("data-palette", key);
        swatch.setAttribute("aria-pressed", String(key === selected));
        const preview = element("div", "", {
          class: "theme-preview",
          "aria-hidden": "true",
        });
        preview.append(element("i"), element("b"));
        swatch.append(
          preview,
          element("span", label),
          element(
            "small",
            key === "graphite"
              ? "Нейтральный серый"
              : key === "midnight"
                ? "Холоднее и глубже"
                : "Мягкий серый",
          ),
        );
        grid.append(swatch);
      }
      themes.append(grid);
      const layout = card("Интерфейс");
      choice(
        layout,
        "Плотность",
        "Размер вкладок и расстояния между элементами.",
        "night.ui.density",
        [
          ["comfortable", "Обычная"],
          ["compact", "Компактная"],
        ],
        "comfortable",
      );
      choice(
        layout,
        "Ширина боковой панели",
        "Больше места названиям или самой странице.",
        "night.ui.sidebar-width",
        [
          [208, "Узкая"],
          [232, "Обычная"],
          [264, "Широкая"],
        ],
        232,
        true,
      );
      toggle(
        layout,
        "Анимации интерфейса",
        "Плавные переходы с учётом системных настроек.",
        "night.ui.animations",
        true,
      );
      toggle(
        layout,
        "Скрывать верхнюю панель",
        "Появляется у верхнего края окна или по Ctrl+L. Сайт занимает освободившееся место.",
        "night.ui.toolbar-autohide",
      );
      row(layout, "Только сайт", "Скрыть обе панели. Вернуть интерфейс: Alt+Shift+F или кнопкой в раскрытой верхней панели.",
        button("Переключить", () => browserWindow.gNightBrowser.shell.toolbar.toggleFocus()));
    }
    function tabs() {
      const startup = card("При запуске");
      choice(
        startup,
        "Открывать",
        "Рабочие области и закреплённые вкладки сохраняются в профиле.",
        "browser.startup.page",
        [
          [3, "Предыдущую сессию"],
          [1, "Новую вкладку"],
        ],
        3,
        true,
      );
      toggle(
        startup,
        "Открывать ссылки в фоне",
        "Не переключаться сразу на вкладку, открытую по ссылке.",
        "browser.tabs.loadInBackground",
        true,
      );
      const shortcuts = card("Сочетания клавиш");
      for (const [name, keys] of [
        ["Новая вкладка", "Ctrl + T"],
        ["Найти вкладку", "Alt + P"],
        ["Разделить экран", "Alt + S"],
        ["Скрыть боковую панель", "Alt + B"],
        ["Только сайт / вернуть интерфейс", "Alt + Shift + F"],
        ["Адресная строка", "Ctrl + L"],
        ["Вернуть закрытую вкладку", "Ctrl + Shift + T"],
      ])
        row(shortcuts, name, "", element("kbd", keys));
    }
    function memory() {
      const memory = browserWindow.gNightBrowser.memory;
      const settings = memory.settings;
      const summary = card("Состояние вкладок");
      const metrics = element("div", "", { class: "metrics" });
      const updateMetrics = () => {
        const tabs = [...browserWindow.gBrowser.tabs].filter(
          (tab) => !tab.closing,
        );
        const sleeping = tabs.filter((tab) =>
          tab.hasAttribute("pending"),
        ).length;
        metrics.replaceChildren(
          ...[
            [tabs.length - sleeping, "загружено"],
            [sleeping, "выгружено"],
            [memory.settings.idleMinutes, "тайм-аут, мин"],
          ].map(([value, label]) => {
            const metric = element("div");
            metric.append(
              element("strong", String(value)),
              element("span", label),
            );
            return metric;
          }),
        );
      };
      updateMetrics();
      summary.append(metrics);
      const policy = card("Неактивные вкладки");
      toggle(
        policy,
        "Освобождать память",
        "Страница восстановится, когда ты к ней вернёшься.",
        "night.memory.enabled",
        true,
      );
      const minutes = element("input", "", {
        type: "number",
        min: "1",
        max: "1440",
        value: settings.idleMinutes,
        id: "idle-minutes",
      });
      row(
        policy,
        "Время до выгрузки",
        "Минут без активности во вкладке.",
        minutes,
      );
      minutes.addEventListener("change", () => {
        try {
          memory.setSettings({
            ...memory.settings,
            idleMinutes: Number(minutes.value),
            excludedSites: memory.settings.excludedSites.join("\n"),
          });
          updateMetrics();
          status("Сохранено");
        } catch (error) {
          status(error.message);
        }
      });
      const exclusions = card(
        "Оставлять загруженными",
        "Эти сайты и их поддомены будут работать в фоне.",
      );
      const chips = element("div", "", { class: "site-list" });
      const render = () => {
        chips.replaceChildren(
          ...memory.settings.excludedSites.map((site) => {
            const chip = element("span", "", { class: "site-chip" });
            chip.append(
              element("span", site),
              button(
                "×",
                () => {
                  save(
                    memory.settings.excludedSites.filter(
                      (value) => value !== site,
                    ),
                  );
                  render();
                },
                "chip-remove",
              ),
            );
            chip
              .querySelector("button")
              .setAttribute("aria-label", `Удалить исключение ${site}`);
            return chip;
          }),
        );
      };
      const save = (sites) => {
        memory.setSettings({
          ...memory.settings,
          excludedSites: sites.join("\n"),
        });
        status("Сохранено");
      };
      const add = element("form", "", { class: "add-site" });
      const input = element("input", "", {
        placeholder: "Например, chatgpt.com",
        "aria-label": "Домен для исключения",
        id: "site-exception",
      });
      const submit = element("button", "Добавить", {
        type: "submit",
        class: "button",
      });
      add.append(input, submit);
      add.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
          save([
            ...new Set([
              ...memory.settings.excludedSites,
              ...parseSiteRules(input.value),
            ]),
          ]);
          input.value = "";
          render();
        } catch (error) {
          status(error.message);
        }
      });
      exclusions.append(chips, add);
      render();
      const note = element("div", "", { class: "info-note" });
      note.append(
        element(
          "span",
          "Активная вкладка, разделённый экран, воспроизведение, звонки и перехват запросов всегда защищены от выгрузки.",
        ),
      );
      document.getElementById("content").append(note);
      const actions = card("");
      row(
        actions,
        "Проверить вкладки сейчас",
        "Применить выбранное время неактивности.",
        button("Проверить", async () => {
          status(`Выгружено вкладок: ${await memory.checkNow()}`);
          updateMetrics();
        }),
      );
    }
    function privacy() {
      const protection = card("Защита при просмотре");
      toggle(
        protection,
        "Блокировать отслеживающие элементы",
        "Встроенная защита блокирует известные трекеры.",
        "privacy.trackingprotection.enabled",
        true,
      );
      toggle(
        protection,
        "Только HTTPS",
        "Предупреждать перед подключением без шифрования.",
        "dom.security.https_only_mode",
        false,
      );
      const passwords = card("Пароли и данные");
      toggle(
        passwords,
        "Предлагать сохранение паролей",
        "Пароли хранятся в локальном профиле браузера.",
        "signon.rememberSignons",
        true,
      );
      row(
        passwords,
        "Сохранённые пароли",
        "Просмотр, изменение и удаление.",
        button("Открыть", () =>
          browserWindow.openTrustedLinkIn("about:logins", "tab"),
        ),
      );
      row(
        passwords,
        "Данные сайтов и разрешения",
        "Cookie, уведомления, камера и микрофон.",
        button("Управлять", () => {
          window.location.href =
            "chrome://browser/content/preferences/advanced.xhtml#privacy";
        }),
      );
    }
    async function search() {
      const { SearchService } = ChromeUtils.importESModule(
        "moz-src:///toolkit/components/search/SearchService.sys.mjs",
      );
      const engine = card("Поисковая система");
      await SearchService.init();
      const select = element("select", "", { id: "search-engine" });
      const engines = await SearchService.getVisibleEngines();
      select.append(
        ...engines.map((item) =>
          element("option", item.name, { value: item.id }),
        ),
      );
      select.value = SearchService.defaultEngine.id;
      select.addEventListener("change", async () => {
        try {
          await SearchService.setDefault(
            engines.find((item) => item.id === select.value),
            SearchService.CHANGE_REASON.USER,
          );
          status("Поисковая система изменена");
        } catch (error) {
          status(error.message);
        }
      });
      row(engine, "По умолчанию", "Для поиска через адресную строку.", select);
      toggle(
        engine,
        "Поисковые подсказки",
        "Запросы для подсказок отправляются выбранной поисковой системе.",
        "browser.search.suggest.enabled",
        true,
      );
    }
    async function importData() {
      const { NightImport } = ChromeUtils.importESModule(
        "resource:///modules/night/NightImport.sys.mjs",
      );
      const intro = card(
        "Данные для переноса",
        "Закладки и история · пароли · cookies и данные сайтов · расширения · вкладки и области",
      );
      intro.classList.add("import-hero");
      intro.append(
        element(
          "p",
          "Исходный профиль Zen не изменится. Перед заменой текущий профиль сохранится в папке profile-backup-… рядом с приложением.",
          { class: "card-caption" },
        ),
      );
      if (!NightImport.supported) {
        intro.append(
          element("p", "Импорт доступен в версии для Windows."),
        );
        return;
      }
      const pending = await NightImport.pending();
      if (pending) {
        const ready = card(
          "Данные готовы к переносу",
          "Перезапусти браузер, чтобы применить импорт. Если отменить выход, копия сохранится до следующего запуска.",
        );
        ready.append(
          button(
            "Перезапустить",
            () => NightImport.restart(),
            "button primary",
          ),
        );
        return;
      }
      const selection = card("Выбери профиль Zen");
      const profiles = await NightImport.discover();
      const select = element("select", "", {
        id: "zen-profile",
        "aria-label": "Профиль Zen",
      });
      for (const profile of profiles)
        select.append(element("option", profile.name, { value: profile.path }));
      const path = element("p", "", { class: "profile-path" });
      const update = () => {
        path.textContent =
          select.value ||
          "Профиль не найден автоматически. Укажи папку вручную.";
      };
      update();
      select.addEventListener("change", update);
      row(
        selection,
        "Профиль",
        "Закрой Zen перед копированием данных.",
        select,
      );
      selection.append(
        path,
        button("Указать папку…", async () => {
          const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
            Ci.nsIFilePicker,
          );
          picker.init(
            browserWindow.browsingContext,
            "Папка профиля Zen",
            Ci.nsIFilePicker.modeGetFolder,
          );
          const result = await new Promise((resolve) => picker.open(resolve));
          if (result !== Ci.nsIFilePicker.returnOK) return;
          await NightImport.inspect(picker.file.path);
          select.append(
            element("option", picker.file.leafName, {
              value: picker.file.path,
            }),
          );
          select.value = picker.file.path;
          update();
          select.dispatchEvent(new Event("change"));
        }),
      );
      const details = card("Что изменится");
      details.append(
        element(
          "p",
          "Данные Zen заменят текущий профиль. Объединения не будет; резервная копия позволит вернуть прежние данные.",
          { class: "card-caption" },
        ),
        element(
          "p",
          "Закреплённые сайты станут общими для областей. Папки и split view развернутся во вкладки. Zen Mods, оформление и привязки клавиш Zen не переносятся. Основной пароль остаётся прежним; отдельные сайты и расширения могут запросить повторный вход.",
          { class: "card-caption" },
        ),
      );
      const consent = element("input", "", {
        type: "checkbox",
        id: "import-consent",
      });
      const label = element("label", "", { class: "import-consent" });
      label.append(
        consent,
        element(
          "span",
          "Заменить текущие данные с сохранением резервной копии",
        ),
      );
      const progress = element("p", "", {
        id: "import-progress",
        role: "status",
      });
      const action = button(
        "Импортировать из Zen",
        async () => {
          if (!consent.checked || !select.value) return;
          action.disabled = true;
          select.disabled = true;
          consent.disabled = true;
          const refresh = () => {
            const state = NightImport.status;
            progress.textContent =
              state.phase === "preparing"
                ? "Готовим вкладки и настройки…"
                : `Копирование: ${state.files || 0} файлов · ${Math.round((state.bytes || 0) / 1048576)} МБ`;
          };
          refresh();
          const timer = window.setInterval(refresh, 500);
          try {
            const report = await NightImport.stage(select.value);
            progress.textContent = `Готово: ${report.tabs} вкладок, ${report.workspaces} областей. ${report.warnings.join(" ")}`;
            details.append(
              button(
                "Перезапустить",
                () => NightImport.restart(),
                "button primary",
              ),
            );
          } catch (error) {
            progress.textContent = error.message;
            action.disabled = false;
            select.disabled = false;
            consent.disabled = false;
          } finally {
            window.clearInterval(timer);
          }
        },
        "button primary",
      );
      action.disabled = true;
      const enable = () => {
        action.disabled = !consent.checked || !select.value;
      };
      consent.addEventListener("change", enable);
      select.addEventListener("change", enable);
      details.append(label, action, progress);
    }
    function about() {
      const info = card("");
      const identity = element("div", "", { class: "about-identity" });
      identity.append(
        element("img", "", {
          src: "chrome://browser/content/night/branding/icon128.png",
          alt: "",
          width: "72",
          height: "72",
        }),
        element("h2", "Night Browser"),
        element("p", "0.5.2 · Preview"),
      );
      info.append(identity);
      row(
        info,
        "Исходный код",
        "История разработки, изменения и сообщения об ошибках.",
        button("GitHub ↗", () =>
          browserWindow.openTrustedLinkIn(
            "https://github.com/1atex/night-browser",
            "tab",
          ),
        ),
      );
      row(
        info,
        "Обновления",
        "Тестовая версия обновляется вручную.",
        button("Проверить релизы ↗", () =>
          browserWindow.openTrustedLinkIn(
            "https://github.com/1atex/night-browser/releases",
            "tab",
          ),
        ),
      );
      const credits = card("Открытые технологии");
      row(
        credits,
        "Firefox / Gecko 160",
        "Движок, расширения и инструменты разработчика Mozilla.",
        button("Лицензии", () =>
          browserWindow.openTrustedLinkIn("about:license", "tab"),
        ),
      );
    }
    const renderers = {
      appearance,
      tabs,
      memory,
      privacy,
      search,
      import: importData,
      about,
    };
    async function render() {
      const raw = location.hash.slice(1);
      const aliases = {
        general: "tabs",
        passwordsAutofill: "privacy",
        paneGeneral: "tabs",
        panePrivacy: "privacy",
      };
      const key = sections[raw] ? raw : (aliases[raw] ?? "appearance");
      document.getElementById("heading").textContent = sections[key][0];
      document.getElementById("description").textContent = sections[key][1];
      document.getElementById("content").replaceChildren();
      status("");
      for (const link of document.querySelectorAll("nav a"))
        link.setAttribute("aria-current", String(link.hash === `#${key}`));
      try {
        await renderers[key]();
      } catch (error) {
        status(error.message);
        console.error(error);
      }
    }
    for (const [key, [name, , icon]] of Object.entries(sections)) {
      const link = element("a", "", { href: `#${key}` });
      link.append(
        element("img", "", {
          src: `chrome://browser/content/night/icons/${icon}.svg`,
          alt: "",
        }),
        element("span", name),
      );
      document.getElementById("navigation").append(link);
    }
    window.gotoPref = (pane) => {
      const key = pane.replace(/^pane/, "");
      location.hash = key.charAt(0).toLowerCase() + key.slice(1);
    };
    window.addEventListener("hashchange", render);
    render();
  },
  { once: true },
);
