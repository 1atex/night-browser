window.addEventListener(
  "DOMContentLoaded",
  () => {
    const { parseSiteRules } = ChromeUtils.importESModule(
      "resource:///modules/night/MemoryPolicy.mjs",
    );
    const {NightIsland} = ChromeUtils.importESModule("resource:///modules/night/NightIsland.sys.mjs");
    const {applyIslandAppearance} = ChromeUtils.importESModule("resource:///modules/night/IslandAppearance.mjs");
    const XHTML = "http://www.w3.org/1999/xhtml";
    const browserWindow = window.browsingContext.topChromeWindow;
    const updateTheme = () => {
      applyIslandAppearance(document.documentElement, NightIsland.sharedAppearance);
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
    Services.prefs.addObserver("night.island.appearance", updateTheme);
    Services.obs.addObserver(updateTheme, "night-island-appearance");
    window.addEventListener(
      "unload",
      () => {
        Services.prefs.removeObserver("night.ui.", updateTheme);
        Services.prefs.removeObserver("night.island.appearance", updateTheme);
        Services.obs.removeObserver(updateTheme, "night-island-appearance");
      },
      { once: true },
    );
    updateTheme();
    const sections = {
      appearance: ["Внешний вид", "Цвета, панели и анимации.", "appearance"],
      updates: ["Обновления", "Новые версии и история изменений.", "download"],
      together: ["Друзья и комнаты", "Совместный просмотр, чат и голос.", "profile"],
      accounts: ["Профили и Sync", "Отдельные данные на этом компьютере и синхронизация через Mozilla.", "profile"],
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
      integrations: ["Интеграции", "Связь с приложениями на этом компьютере.", "island"],
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
        ["night", "Чёрная"],
        ["graphite", "Графит"],
        ["midnight", "Полночь"],
        ["mist", "Туман"],
      ]) {
        const swatch = button(
          "",
          () => {
            const shared = !!NightIsland.sharedAppearance;
            if (shared) Services.prefs.setBoolPref("night.island.appearance", false);
            Services.prefs.setStringPref("night.ui.palette", key);
            grid
              .querySelectorAll("button")
              .forEach((node) =>
                node.setAttribute("aria-pressed", String(node === swatch)),
              );
            status(shared ? "Палитра изменена. Оформление из Island выключено." : "Палитра изменена");
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
            key === "night"
              ? "Глубокий чёрный"
              : key === "graphite"
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
      choice(layout, "Адрес и навигация", "В боковой панели или отдельной полосой над сайтом.",
        "night.ui.navigation-layout", [["sidebar", "В боковой панели"], ["top", "Сверху"]], "sidebar");
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
      const width = element("input", "", {type: "range", min: "240", max: "420", step: "1", "data-pref": "night.ui.sidebar-width"});
      width.value = Services.prefs.getIntPref("night.ui.sidebar-width", 320);
      width.addEventListener("input", () => Services.prefs.setIntPref("night.ui.sidebar-width", Number(width.value)));
      row(layout, "Ширина боковой панели", "Потяни край панели мышью или используй ползунок.", width);
      toggle(layout, "Кнопки окна при наведении", "Сворачивание, размер и закрытие — в правом верхнем углу.", "night.ui.window-controls-autohide", true);
      toggle(layout, "Поиск вкладок на панели", "Всегда доступен по Alt+P.", "night.ui.show-tab-search", false);
      toggle(layout, "Счётчик вкладок", "Количество загруженных и выгруженных страниц.", "night.ui.show-memory-status", false);
      toggle(layout, "Все значки адресной строки", "По умолчанию закладки, масштаб и разрешения доступны в меню ⋯. Активные камера, микрофон и предупреждения остаются видны.", "night.ui.address-details", false);
      toggle(layout, "Кнопки инструментов", "Разделение экрана и запросы. Настройки остаются доступны.", "night.ui.show-tools", true);
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
      summary.append(element("p", "Счётчик показывает вкладки в этом окне отдельно от расхода процессов. Интерфейс, расширения, графика и кэш тоже занимают память.", {class: "card-caption"}));
      row(summary, "Что занимает память", "Страницы, расширения и служебные процессы с их текущим расходом.",
        button("Открыть процессы", () => browserWindow.openTrustedLinkIn("about:processes", "tab")));
      const details = card("Почему вкладки остаются загруженными", "Закрепление не мешает выгрузке. Исключение для домена действует и без воспроизведения.");
      const reasons = {visible: "На экране", unavailable: "Выгружена", protected: "Защищена вручную или перехватом", media: "Воспроизведение, звонок или демонстрация", loading: "Загружается", private: "Приватная вкладка", internal: "Внутренняя страница", "site-exception": "Домен в исключениях", recent: "Ещё не истёк таймер", disabled: "Выгрузка отключена", unload: "Можно выгрузить"};
      const tabDetails = element("div", "", {id: "memory-tab-details"});
      const refreshDetails = () => {
        tabDetails.replaceChildren();
        for (const tab of browserWindow.gBrowser.tabs) {
          if (tab.closing) continue;
          const reason = memory.describe(tab);
          row(tabDetails, tab.label, reasons[reason] || reason,
            ["recent", "unload"].includes(reason) ? button("Выгрузить", async () => {
              status(await memory.unload(tab) ? "Вкладка выгружена" : "Вкладка сейчас защищена или страница не разрешила выгрузку");
              refreshDetails(); updateMetrics();
            }) : null);
        }
      };
      details.append(button("Обновить", () => {refreshDetails(); updateMetrics();}), tabDetails);
      refreshDetails();
      const reserve = card("Резерв для новых вкладок");
      toggle(reserve, "Готовить один процесс заранее", "Ускоряет открытие следующего сайта и занимает дополнительную память. Можно отключить; существующие страницы продолжат работать.", "dom.ipc.processPrelaunch.enabled", true);
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
        "Эти сайты и их поддомены работают в фоне, включая поставленное на паузу видео. Убери YouTube из списка, чтобы неиграющие вкладки могли выгружаться по таймеру. Воспроизведение и PiP защищены и без исключения.",
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
      if (Services.prefs.getBoolPref("night.import.completed", false)) {
        const repair = card("Восстановить структуру прошлого импорта", "Вернуть папки и закрепления по сохранённому снимку Zen. История, пароли и данные сайтов сохранятся. Несовпадающие и неоднозначные вкладки останутся как есть.");
        repair.append(button("Восстановить папки", async () => {
          const result = await NightImport.repair(browserWindow);
          status(`Восстановлено: ${result.matched}. Пропущено: ${result.skipped}. Резервная копия: ${result.backup}`);
        }));
      }
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
          "Избранное останется общим, закрепления и вложенные папки сохранят свои пространства. Split view станут отдельными вкладками в прежних папках. Zen Mods, оформление и привязки клавиш Zen не переносятся. Основной пароль остаётся прежним; отдельные сайты и расширения могут запросить повторный вход.",
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
        element("p", ChromeUtils.importESModule("resource:///modules/night/NightVersion.sys.mjs").version + " · Preview"),
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
        "Проверка и установка из браузера.",
        button("Открыть обновления", () => { location.hash = "updates"; }),
      );
      const credits = card("Открытые технологии");
      row(credits, "Material Symbols", "Значки Google, Apache License 2.0.",
        button("Лицензия", () => browserWindow.openTrustedLinkIn("chrome://browser/content/night/material-license.txt", "tab")));
      row(
        credits,
        "Firefox / Gecko 160",
        "Движок, расширения и инструменты разработчика Mozilla.",
        button("Лицензии", () =>
          browserWindow.openTrustedLinkIn("about:license", "tab"),
        ),
      );
    }
    function integrations() {
      const {NightIsland} = ChromeUtils.importESModule("resource:///modules/night/NightIsland.sys.mjs");
      const supported = Services.appinfo.OS === "WINNT";
      const section = card("Night Island", "Вкладки, материалы и действия браузера доступны из острова.");
      const connection = element("div", "", {class: "island-connection"});
      const mark = element("img", "", {src: "chrome://browser/content/night/icons/island.svg", alt: ""});
      const summary = element("div", "", {class: "island-connection-copy"});
      const state = element("strong", "", {id: "island-status", role: "status", "aria-live": "polite", "aria-atomic": "true"});
      const hint = element("p", "", {id: "island-hint"});
      const retry = button("Подключить снова", () => NightIsland.retryNow());
      retry.id = "island-retry";
      const openIsland = button("Открыть загрузки", () => NightIsland.openDownloads());
      openIsland.id = "island-open";
      summary.append(state, hint);
      connection.append(mark, summary, retry, openIsland);
      section.append(connection);
      toggle(section, "Показывать загрузки в Island", "Прогресс, пауза, продолжение и открытие папки с готовым файлом.", "night.island.downloads", false);
      section.querySelector('[data-pref="night.island.downloads"]').disabled = !supported;
      toggle(section, "Поиск вкладок через Island", "Ctrl+Alt+B в Island или @ в его командной строке. Видны названия, сайты и пути папок; спящие страницы загружаются только после выбора.", "night.island.tabs", false);
      toggle(section, "Карман", "Ссылки, выделенный текст и ссылки на изображения сохраняются по команде из контекстного меню страницы.", "night.island.pocket", false);
      toggle(section, "Активность сайтов", "Звучащие вкладки, микрофон, камера и демонстрация экрана. Переход к источнику и отключение звука вкладки.", "night.island.activity", false);
      toggle(section, "Перехваченные запросы", "Метод и сайт ожидающего запроса. Пропустить, отбросить или перейти к редактированию.", "night.island.requests", false);
      const hubActions = element("div", "", {class: "button-row"});
      hubActions.append(button("Открыть вкладки и активность", () => { if (!NightIsland.openPanel("browser")) status("Подключи совместимую версию Island."); }),
        button("Открыть Карман", () => { if (!NightIsland.openPanel("pocket")) status("Подключи совместимую версию Island."); }));
      section.append(hubActions);
      toggle(section, "Индикатор в боковой панели", "Быстрый переход в Island; при включённых загрузках — файл и прогресс.", "night.island.indicator", true);
      choice(section, "Расположение индикатора", "Перемещается сразу, без перезапуска браузера.", "night.island.position",
        [["bottom", "Внизу боковой панели"], ["top", "Вверху боковой панели"]], "bottom");
      choice(section, "Когда показывать", "Незавершённые загрузки включают паузу и ошибки. При потере связи остаётся сообщение о подключении.", "night.island.visibility",
        [["always", "Всегда"], ["unfinished", "Только незавершённые загрузки"]], "always");
      toggle(section, "Оформление из Island", "Фон, акцент и анимации. При выключении вернётся выбранная палитра браузера.", "night.island.appearance", true);
      for (const input of section.querySelectorAll("[data-pref]")) input.disabled = !supported;
      const steps = element("ol", "", {class: "island-setup", id: "island-setup"});
      const install = element("li");
      install.append(element("span", "Запусти Island с поддержкой интеграции. "));
      const releases = element("a", "Скачать совместимую версию", {href: "https://github.com/1atex/night-island/releases", target: "_blank", rel: "noopener"});
      install.append(releases);
      steps.append(install, element("li", "В Island открой Настройки → Интеграции и включи «Связь с Night Browser»."));
      section.append(steps);
      const note = element("p", "Поиск передаёт результаты по запросу; активность — названия сайтов и состояния. Карман сохраняет только выбранные тобой материалы. Приватные вкладки и загрузки, тела и заголовки запросов не передаются.", {class: "island-privacy"});
      section.append(note);
      const update = () => {
        const key = supported ? NightIsland.status : "unsupported";
        const labels = {
          disabled: ["Связь выключена", "Включи нужные возможности ниже."],
          connecting: ["Подключаемся к Island…", "Загрузки в браузере продолжаются как обычно."],
          connected: ["Island подключён", "Возможности включаются отдельно. Изменения применяются сразу."],
          waiting: ["Ожидаем Island", "Соединение восстановится автоматически, когда Island будет доступен."],
          unavailable: ["Не удалось подключиться", "Проверь, что интеграция включена в обоих приложениях."],
          unsupported: ["Доступно в Windows", "Связь с Island работает в версии браузера для Windows."],
        };
        const problems = {
          "not-running": ["Island не найден", "Запусти Island и включи в нём «Связь с Night Browser». Подключение произойдёт автоматически."],
          "peer-name": ["Не удалось распознать Island", "Запусти night-island.exe. Копии с номером, например night-island (1).exe, тоже поддерживаются."],
          "peer-identity": ["Не удалось проверить Island", "Оба приложения должны работать в одной учётной записи Windows."],
          "peer-access": ["Нет доступа к Island", "Закрой оба приложения и запусти их обычным способом, без прав администратора."],
          "access-denied": ["Windows запретила соединение", "Закрой оба приложения и запусти их обычным способом, без прав администратора."],
          "pipe-busy": ["Соединение Island занято", "Закрой другие копии Night Browser. Подключение повторится автоматически."],
          "handshake-timeout": ["Island не ответил", "Проверь версию Island. Если она совместимая, перезапусти Island."],
          "protocol": ["Версии интеграции несовместимы", "Установи совместимую версию Island по ссылке ниже."],
        };
        const [title, description] = problems[NightIsland.reason] ?? labels[key] ?? labels.unavailable;
        state.textContent = title;
        hint.textContent = description + (NightIsland.errorCode ? ` Код Windows: ${NightIsland.errorCode}.` : "");
        connection.dataset.state = key;
        retry.hidden = !["waiting", "unavailable"].includes(key);
        openIsland.hidden = key !== "connected" || !NightIsland.capabilities.has("show-downloads");
        const visual = NightIsland.capabilities.has("show-downloads") && NightIsland.capabilities.has("appearance");
        if (key === "connected" && !visual) hint.textContent = "Загрузки подключены. Для раскрытия Island из браузера и общего оформления обнови Island по ссылке ниже.";
        const missing = ["tabs", "pocket", "activity", "requests"].some(name => Services.prefs.getBoolPref(`night.island.${name}`, false) && !NightIsland.capabilities.has(name));
        if (key === "connected" && missing) hint.textContent = "Подключена старая версия Island. Для новых возможностей обнови Island по ссылке ниже.";
        for (const control of hubActions.querySelectorAll("button")) control.disabled = key !== "connected" || missing;
        steps.hidden = !supported || key === "connected" && visual && !missing;
      };
      update();
      Services.obs.addObserver(update, "night-island-status");
      const remove = () => {
        Services.obs.removeObserver(update, "night-island-status");
        window.removeEventListener("hashchange", remove);
        window.removeEventListener("unload", remove);
      };
      window.addEventListener("hashchange", remove, {once: true});
      window.addEventListener("unload", remove, {once: true});
    }

    async function accounts() {
      const {NightProfiles} = ChromeUtils.importESModule("resource:///modules/night/NightProfiles.sys.mjs");
      const {NightAccounts} = ChromeUtils.importESModule("resource:///modules/night/NightAccounts.sys.mjs");
      const {PrivateBrowsingUtils} = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
      if (PrivateBrowsingUtils.isWindowPrivate(browserWindow)) {
        card("Приватное окно", "Профили и синхронизация настраиваются в обычном окне. Приватная история не синхронизируется.");
        return;
      }
      const profiles = card("Профили на этом компьютере", "Пароли, cookies, расширения, вкладки и оформление разделены. Профиль открывается в своём окне; повторный выбор возвращает к открытому окну.");
      profiles.id = "night-profiles-settings";
      profiles.append(element("p", "Каждый открытый профиль использует память отдельно. Закрой его окна, когда он не нужен.", {class: "card-caption"}));
      const items = await NightProfiles.list();
      if (!profiles.isConnected) return;
      for (const item of items) {
        const controls = element("div", "", {class: "profile-actions"});
        const open = button(item.current ? "Текущий" : "Открыть", () => NightProfiles.open(item.id, browserWindow));
        open.disabled = item.current || !NightProfiles.context.managed;
        open.dataset.profileId = item.id;
        controls.append(open);
        row(profiles, item.name, item.current ? "Данные этого окна" : "Независимый набор данных", controls);
        if (NightProfiles.context.managed) {
          controls.append(button("Настроить", () => { editor.hidden = !editor.hidden; }));
          const editor = element("div", "", {class: "profile-editor", hidden: "", "data-profile-editor": item.id});
          const {PROFILE_COLORS, PROFILE_ICONS, profileBadge} = ChromeUtils.importESModule("resource:///modules/night/ProfileModel.mjs");
          const preview = element("span", profileBadge(item), {class: "profile-badge", "aria-hidden": "true"});
          const name = element("input", "", {value: item.name, maxlength: "40", "aria-label": "Название профиля"});
          const color = element("select", "", {"aria-label": "Цвет значка"}), icon = element("select", "", {"aria-label": "Значок профиля"});
          const titles = {moon: "Лунный", violet: "Сиреневый", sky: "Голубой", jade: "Мятный", amber: "Янтарный", rose: "Розовый"};
          for (const key of Object.keys(PROFILE_COLORS)) color.append(element("option", titles[key], {value: key}));
          for (const key of PROFILE_ICONS) icon.append(element("option", key === "initial" ? "Первая буква" : key, {value: key}));
          color.value = item.color; icon.value = item.icon;
          const update = () => { preview.textContent = profileBadge({name: name.value || "П", icon: icon.value}); preview.style.setProperty("--profile-color", PROFILE_COLORS[color.value]); };
          for (const input of [name, color, icon]) input.addEventListener("input", update);
          update();
          const save = button("Сохранить профиль", async () => { await NightProfiles.customize(item.id, {name: name.value, color: color.value, icon: icon.value}); status("Профиль сохранён"); await render(); });
          editor.append(preview, name, color, icon, save); profiles.append(editor);
        }
      }
      if (NightProfiles.context.managed) {
        const form = element("form", "", {class: "profile-create", id: "night-create-profile"});
        const name = element("input", "", {id: "night-profile-name", placeholder: "Например, Рабочий", "aria-label": "Название нового профиля", maxlength: "40", required: "required"});
        const palette = element("select", "", {id: "night-profile-palette", "aria-label": "Оформление нового профиля"});
        for (const [value, title] of [["night", "Чёрная"], ["graphite", "Графит"], ["midnight", "Полночь"], ["mist", "Туман"]]) palette.append(element("option", title, {value}));
        const submit = element("button", "Создать профиль", {type: "submit", class: "button"});
        form.append(name, palette, submit); profiles.append(form);
        form.addEventListener("submit", async event => {
          event.preventDefault(); submit.disabled = true;
          try {
            const id = await NightProfiles.create(name.value, palette.value);
            status("Профиль создан. Открываем окно…");
            await NightProfiles.open(id, browserWindow);
            if (profiles.isConnected) await render();
          } catch (error) { status(error.message); }
          finally { submit.disabled = false; }
        });
      } else profiles.append(element("p", "Создание и переключение профилей доступны при запуске через Night.exe.", {class: "card-caption"}));
      const sync = card("Аккаунт Mozilla", "Mozilla Sync переносит закладки, пароли, историю, расширения и выбранные настройки между устройствами. Вход в Google на сайте профиль браузера не переключает.");
      const title = element("strong", "", {id: "night-sync-state"});
      const description = element("p", "", {id: "night-sync-detail", class: "card-caption"});
      const actions = element("div", "", {class: "profile-actions"});
      const connect = button("Подключить Mozilla Sync", () => NightAccounts.connect(browserWindow)); connect.id = "night-sync-connect";
      const now = button("Синхронизировать", () => NightAccounts.sync(browserWindow)); now.id = "night-sync-now";
      const settings = button("Параметры Sync", () => NightAccounts.settings(browserWindow), "button secondary");
      const disconnect = button("Выйти из аккаунта…", () => NightAccounts.disconnect(browserWindow), "button secondary");
      actions.append(connect, now, settings, disconnect); sync.append(title, description, actions);
      const data = card("Что синхронизировать", "Настройки включают палитру, плотность, анимации, расположение навигации и виджеты Night. Cookies и структура папок Night через Sync не передаются.");
      for (const [engine, label] of [["bookmarks", "Закладки"], ["passwords", "Пароли"], ["history", "История"], ["tabs", "Открытые вкладки"], ["addons", "Расширения"], ["prefs", "Настройки и оформление"]])
        toggle(data, label, "", `services.sync.engine.${engine}`, true);
      data.append(element("p", "Sync объединяет данные профиля с аккаунтом. Для другого человека или аккаунта создай отдельный профиль.", {class: "card-caption"}));
      const update = () => {
        if (!sync.isConnected) return;
        const state = NightAccounts.state(browserWindow);
        const signed = state.status === "signed_in";
        const configured = signed && state.syncEnabled && state.hasSyncKeys;
        title.textContent = state.email || "Вход не выполнен";
        description.textContent = state.status === "disabled" ? "Синхронизация выключена. Подключается только после твоего выбора." :
          state.status === "login_failed" ? "Нужно войти снова." : state.status === "not_verified" ? "Подтверди адрес электронной почты." :
          signed ? state.syncing ? "Синхронизация…" : configured ? (state.lastSync ? `Последняя синхронизация: ${new Date(state.lastSync).toLocaleString("ru-RU")}` : "Sync подключён") : "Аккаунт подключён; включи Sync для переноса данных." : "Войди на официальной странице Mozilla.";
        connect.hidden = configured;
        connect.textContent = signed ? "Включить Sync" : state.status === "not_verified" ? "Подтвердить аккаунт" : "Подключить Mozilla Sync";
        now.hidden = !configured; now.disabled = !!state.syncing;
        settings.hidden = !signed; disconnect.hidden = !state.email;
      };
      update();
      Services.obs.addObserver(update, "sync-ui-state:update");
      Services.prefs.addObserver("identity.fxaccounts.enabled", update);
      sectionCleanup = () => {
        Services.obs.removeObserver(update, "sync-ui-state:update");
        Services.prefs.removeObserver("identity.fxaccounts.enabled", update);
      };
    }

    function updates() {
      const {NightUpdates} = ChromeUtils.importESModule("resource:///modules/night/NightUpdates.sys.mjs");
      const {version} = ChromeUtils.importESModule("resource:///modules/night/NightVersion.sys.mjs");
      const section = card(`Night ${version}`, "Проверка выполняется по нажатию. Файлы загружаются с официальных релизов Night и проверяются по SHA-256.");
      const label = element("p", "", {id: "night-update-status", role: "status"});
      const install = button("Установить и перезапустить", async () => {
        if (!Services.prompt.confirm(browserWindow, "Обновление Night", "Будут закрыты окна всех профилей Night. Заверши работу с несохранёнными формами. Продолжить?")) return;
        install.disabled = true; label.textContent = "Загружаем и проверяем обновление…";
        try { await NightUpdates.install(browserWindow); } finally { install.disabled = false; }
      });
      install.id = "night-update-install"; install.hidden = true;
      const check = button("Проверить обновления", async () => {
        check.disabled = true; label.textContent = "Проверяем…";
        try {
          const candidate = await NightUpdates.check();
          label.textContent = candidate ? `Доступна версия ${candidate.version}` : "Установлена последняя доступная версия.";
          install.hidden = !candidate || !NightUpdates.supported;
        } catch (error) { label.textContent = error.message; }
        finally { check.disabled = false; }
      });
      check.id = "night-update-check";
      section.append(label, check, install, button("Что нового", () => browserWindow.openTrustedLinkIn("chrome://browser/content/night/changes.html", "tab")));
      if (!NightUpdates.supported) section.append(element("p", "Установка обновлений из браузера доступна в установленной версии Windows. Для portable пока нужно заменить файлы приложения вручную.", {class: "card-caption"}));
    }

    async function together() {
      const {NightTogether} = ChromeUtils.importESModule("resource:///modules/night/NightTogether.sys.mjs");
      const {PrivateBrowsingUtils} = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
      if (PrivateBrowsingUtils.isWindowPrivate(browserWindow)) { card("Приватное окно", "Друзья и комнаты доступны в обычном окне."); return; }
      const section = card("Night Together", "Добавь друга, создай комнату со ссылкой на видео и пригласи его. Участники нажимают «Смотреть вместе»; пауза, продолжение и перемотка общие.");
      const credentials = await NightTogether.credentials();
      if (!section.isConnected) return;
      if (!credentials) {
        const configured = Services.prefs.getStringPref("night.together.server", "");
        const endpoint = element("input", "", {type: "url", placeholder: "https://together.example.com", "aria-label": "Адрес сервера"});
        section.append(element("p", configured ? "Получи ID и отправь его другу. Запрос дружбы нужно подтвердить." : "Укажи адрес общего сервера один раз.", {class: "card-caption"}));
        if (!configured) section.append(endpoint);
        section.append(button("Получить мой ID", async () => { await NightTogether.connect(configured || endpoint.value, browserWindow); await render(); }));
        return;
      }
      row(section, "Мой ID", credentials.id, button("Скопировать", () => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(credentials.id)));
      const friend = element("input", "", {placeholder: "ID друга", maxlength: "16", "aria-label": "ID друга"});
      section.append(friend, button("Добавить друга", async () => { await NightTogether.action({type: "friend-request", id: friend.value.trim().toLowerCase()}); await refresh(); }));
      const personal = card("Как тебя видят друзья", "Имя, цвет и значок видны друзьям и участникам комнаты. ID остаётся прежним.");
      const {PROFILE_COLORS, PROFILE_ICONS, profileBadge} = ChromeUtils.importESModule("resource:///modules/night/ProfileModel.mjs");
      const name = element("input", "", {id: "together-profile-name", maxlength: "40", "aria-label": "Имя для друзей"});
      const color = element("select", "", {id: "together-profile-color", "aria-label": "Цвет профиля"}), icon = element("select", "", {id: "together-profile-icon", "aria-label": "Значок профиля"});
      for (const [value, title] of [["moon", "Лунный"], ["violet", "Сиреневый"], ["sky", "Голубой"], ["jade", "Мятный"], ["amber", "Янтарный"], ["rose", "Розовый"]]) color.append(element("option", title, {value}));
      for (const value of PROFILE_ICONS) icon.append(element("option", value === "initial" ? "Первая буква" : value, {value}));
      const preview = element("span", "", {class: "profile-badge", "aria-hidden": "true"});
      const updatePreview = () => { preview.textContent = profileBadge({name: name.value || "П", icon: icon.value}); preview.style.setProperty("--profile-color", PROFILE_COLORS[color.value] ?? PROFILE_COLORS.moon); };
      for (const input of [name, color, icon]) input.addEventListener("input", updatePreview);
      const savePersonal = button("Сохранить имя и аватар", async () => { await action({type: "profile-update", name: name.value, color: color.value, icon: icon.value}); status("Профиль для друзей сохранён"); });
      personal.append(preview, name, color, icon, savePersonal);
      let profileLoaded = false;
      const list = element("div"), room = card("Комната", "В комнату передаётся только явно выбранная ссылка и команды времени. Видео каждый участник открывает со своим доступом к сайту.");
      section.append(list);
      const roomBody = element("div"); room.append(roomBody);
      const watchStatus = element("p", NightTogether.watchStatus, {id: "together-watch-status", role: "status"});
      room.append(watchStatus);
      const watchUpdate = () => { watchStatus.textContent = NightTogether.watchStatus; };
      Services.obs.addObserver(watchUpdate, "night-together-watch");
      let pollTimer = null;
      sectionCleanup = () => { window.clearInterval(pollTimer); document.removeEventListener("visibilitychange", refresh); Services.obs.removeObserver(watchUpdate, "night-together-watch"); };
      let refreshing = false, snapshot = "";
      async function action(body) { await NightTogether.action(body); await refresh(); }
      async function refresh() {
        if (refreshing || !section.isConnected || document.hidden) return;
        refreshing = true;
        try {
          const state = await NightTogether.state();
          if (!section.isConnected) return;
          for (const control of [name, color, icon, savePersonal]) control.disabled = (state.protocol ?? 1) < 2;
          if ((state.protocol ?? 1) < 2) status("Обнови сервер Together для аватаров и синхронизации видео. ID и друзья сохранятся.");
          if (!profileLoaded && state.self) { name.value = state.self.name; color.value = state.self.color; icon.value = state.self.icon; updatePreview(); profileLoaded = true; }
          const roomShape = state.room ? {...state.room, position: 0, revision: 0, updatedAt: 0, paused: false, rate: 1, buffering: false, controlledBy: ""} : null;
          const nextSnapshot = JSON.stringify({...state, room: roomShape, serverTime: 0, watching: !!NightTogether.watchSession});
          if (nextSnapshot === snapshot) return;
          snapshot = nextSnapshot;
          list.replaceChildren(); roomBody.replaceChildren();
          const label = id => state.people?.[id]?.name || id;
          const badge = item => { const value = element("span", profileBadge(item), {class: "profile-badge", "aria-hidden": "true"}); value.style.setProperty("--profile-color", PROFILE_COLORS[item.color] ?? PROFILE_COLORS.moon); return value; };
          for (const id of state.incoming) row(list, "Запрос от " + label(id), id, (() => { const actions = element("div", "", {class: "profile-actions"}); actions.append(button("Принять", () => action({type: "friend-accept", id})), button("Отклонить", () => action({type: "friend-decline", id}))); return actions; })());
          for (const id of state.outgoing) row(list, label(id), "Ожидаем подтверждения · " + id, button("Отменить", () => action({type: "friend-decline", id})));
          for (const item of state.friends) {
            const actions = element("div", "", {class: "profile-actions"});
            if (state.room?.owner === state.id) actions.append(button("Пригласить", () => action({type: "room-invite", room: state.room.id, id: item.id})));
            actions.append(button("Удалить", () => action({type: "friend-remove", id: item.id})));
            const node = row(list, item.name || item.id, item.id, actions);
            if (item.name) node.prepend(badge(item));
          }
          for (const invitation of state.invitations) row(roomBody, "Приглашение от " + label(invitation.owner), invitation.id, button("Войти", () => action({type: "room-join", room: invitation.id})));
          if (state.room) {
            const count = state.room.members.length;
            roomBody.append(element("p", `${count} ${count === 1 ? "участник" : count < 5 ? "участника" : "участников"} · Ведущий: ${state.room.owner === state.id ? "ты" : label(state.room.owner)}`));
            if ((state.protocol ?? 1) < 2) roomBody.append(element("p", "Для синхронизации и аватаров обнови сервер Together.", {class: "card-caption"}));
            const chat=button("Чат и голос",()=>NightTogether.openRoom(browserWindow));chat.disabled=(state.protocol??1)<3;roomBody.append(chat);
            if((state.protocol??1)<3)roomBody.append(element("p","Для общей паузы, ссылок, чата и голоса обнови сервер Together до 0.15.",{class:"card-caption"}));
            if(state.protocol>=3 && state.room.owner===state.id){
              roomBody.append(button("Скопировать приглашение",async()=>{const next=await NightTogether.action({type:"room-link",room:state.room.id});Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(next.room.link);status("Приглашение скопировано. Ссылка действует 24 часа; вход подтверждаешь ты.");await refresh();}));
              roomBody.append(button("Обновить ссылку",async()=>{await NightTogether.action({type:"room-link",room:state.room.id,rotate:true});status("Старая ссылка отозвана. Скопируй новое приглашение.");await refresh();}));
              for(const person of state.room.requests??[]){const controls=element("div","",{class:"profile-actions"});controls.append(button("Принять",()=>action({type:"room-admit",room:state.room.id,id:person.id})),button("Отклонить",()=>action({type:"room-deny",room:state.room.id,id:person.id})));row(roomBody,person.name,"Просится по ссылке",controls);}
            }
            const watch = button("Смотреть вместе", () => NightTogether.watch(browserWindow)); watch.id = "together-watch"; watch.disabled = (state.protocol ?? 1) < 2;
            roomBody.append(watch);
            if (NightTogether.watchSession) roomBody.append(button("Остановить синхронизацию", () => { NightTogether.stopWatch(); refresh(); }));
            if (state.room.owner === state.id) {
              const source = element("input", "", {type: "url", value: state.room.url, "aria-label": "Новое видео комнаты"});
              roomBody.append(source, button("Сменить видео", () => action({type: "room-source", room: state.room.id, url: source.value})));
            }
            row(roomBody, "Ссылка комнаты", state.room.url, button("Открыть видео", () => { const url = new URL(state.room.url); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Некорректная ссылка комнаты."); browserWindow.openTrustedLinkIn(url.href, "tab"); }));
            roomBody.append(button("Покинуть комнату", () => action({type: "room-leave"})));
          } else {
            const url = element("input", "", {type: "url", placeholder: "Ссылка на видео", "aria-label": "Ссылка комнаты"});
            roomBody.append(url, button("Создать комнату", () => action({type: "room-create", url: url.value})));
          }
        } catch (error) { status(error.message); }
        finally { refreshing = false; }
      }
      section.append(button("Обновить список", refresh), button("Отключить этот ID…", async () => {
        if (!Services.prompt.confirm(browserWindow, "Отключить ID", "Локальный ключ будет удалён. Этот ID нельзя будет восстановить без резервной копии профиля. Продолжить?")) return;
        await NightTogether.disconnect(); await render();
      }));
      await refresh();
      if (!section.isConnected) return;
      pollTimer = window.setInterval(refresh, 5000);
      document.addEventListener("visibilitychange", refresh);
    }

    const renderers = {
      updates,
      together,
      accounts,
      appearance,
      integrations,
      tabs,
      memory,
      privacy,
      search,
      import: importData,
      about,
    };
    let sectionCleanup = null;
    function cleanupSection() { sectionCleanup?.(); sectionCleanup = null; }
    window.addEventListener("unload", cleanupSection, {once: true});
    async function render() {
      cleanupSection();
      const raw = location.hash.slice(1);
      const action = new URLSearchParams(location.search).get("action");
      if (["sync", "sync-sync"].includes(raw) && ["pair", "choose-what-to-sync"].includes(action)) {
        const {NightAccounts} = ChromeUtils.importESModule("resource:///modules/night/NightAccounts.sys.mjs");
        if (!["disabled", "private"].includes(NightAccounts.state(browserWindow).status)) {
          location.replace(`chrome://browser/content/preferences/advanced.xhtml?action=${action}#sync`);
          return;
        }
      }
      const aliases = {
        sync: "accounts",
        "sync-sync": "accounts",
        paneSync: "accounts",
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
