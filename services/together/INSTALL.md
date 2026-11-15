# Установка Night Together

Для Debian 12/13 или Ubuntu 22.04/24.04 с systemd. Запускать от root или через sudo.

1. В DNS создай `A browser.night-watchers.com → 144.91.104.48`. Если есть неправильная AAAA-запись, исправь её или убери. Дождись обновления DNS. Для первой настройки удобно отключить proxy/CDN, чтобы HTTPS выдавался на сервер напрямую.
2. Разреши входящие TCP 80 и 443 в панели хостинга и firewall. Порт 8787 наружу не открывай. Не меняй правило SSH. Если уже используешь nginx/Apache на 80/443 — сначала настрой существующий reverse proxy на `127.0.0.1:8787` и сертификат; install.sh с Caddy тогда не запускай.
3. Скачай и распакуй архив:

```sh
curl -fL https://github.com/1atex/night-browser/releases/download/v0.13.0-preview.1/night-together-server-0.13.0.zip -o /tmp/night-together.zip
sudo apt-get update && sudo apt-get install -y unzip
sudo mkdir -p /opt/night-browser
sudo unzip -o /tmp/night-together.zip -d /opt/night-browser
cd /opt/night-browser
sudo bash services/together/deploy/install.sh
```

Установщик добавляет отдельный Node 22 в `/opt/night-browser/node`, проверяя SHA-256 официального архива. Системный Node не заменяется. Сервис работает от `night-together`; данные — в `/var/lib/night-together/state.json`, права каталога 700. Существующий основной Caddyfile сохраняется в резервную копию и дополняется import. Если конфигурация этого домена уже существует в основном файле, настрой её вручную, чтобы не было дубликата.

```sh
curl -f https://browser.night-watchers.com/health
sudo systemctl status night-together --no-pager
sudo journalctl -u night-together -n 80 --no-pager
sudo journalctl -u caddy -n 80 --no-pager
```

Ожидается `{"ok":true}`. В Night: «Друзья и комнаты → Получить мой ID». Друг делает то же самое, добавляет твой ID; ты принимаешь запрос. Для этого обоим нужен Night 0.13, дополнительных клиентов не требуется.

Если HTTPS ещё не заработал — проверь DNS/AAAA, входящие порты и журнал Caddy. Скрипт firewall не меняет. Не публикуй state.json и не отдавай каталог данных через веб-сервер: там ключи доступа.

Для резервного копирования останови сервис, скопируй state.json в защищённое место и снова запусти. Повторная распаковка/установка сохраняет каталог данных. Для обновления кода распакуй новый архив в тот же каталог и выполни `sudo systemctl restart night-together`.

Это закрытый пилот: комнаты и друзья реализованы, синхронизация плееров сайтов пока следующий этап. Открытая массовая регистрация требует дополнительной защиты от ботов, мониторинга и процедуры удаления/восстановления ID. Подробности — docs/night/TOGETHER.md в архиве.
