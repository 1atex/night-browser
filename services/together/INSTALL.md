# Night Together через Docker

На сервере нужны Docker Engine и Docker Compose v2. Установка Docker: https://docs.docker.com/engine/install/ . Системный Node.js не нужен.

В DNS создай `A browser.night-watchers.com → 144.91.104.48`. Убери неправильную AAAA-запись, если она есть. Открой входящие TCP 80 и 443 в панели хостинга/firewall; не открывай 8787. Для первого запуска удобно отключить proxy/CDN и направить домен прямо на сервер. Caddy автоматически получает сертификат и перенаправляет HTTP на HTTPS.

## Запуск

```sh
curl -fL https://github.com/1atex/night-browser/releases/download/v0.13.0-preview.5/night-together-server-0.13.0.zip -o /tmp/night-together.zip
sudo mkdir -p /opt/night-together
sudo unzip -o /tmp/night-together.zip -d /opt/night-together
cd /opt/night-together/services/together
sudo docker compose up -d --build
```

Если unzip отсутствует: `sudo apt-get update && sudo apt-get install -y unzip` для Debian/Ubuntu.

```sh
sudo docker compose ps
sudo docker compose logs --tail=80 together caddy
curl -f https://browser.night-watchers.com/health
```

Ожидается `{"ok":true}`. В Night 0.13: «Друзья и комнаты → Получить мой ID». Друг делает то же, добавляет твой ID, ты подтверждаешь запрос. Адрес уже встроен в клиент.

Compose поднимает два контейнера: Node-сервис под пользователем node без root, с read-only файловой системой и отдельным volume; Caddy для HTTPS. Порт сервиса доступен только внутри Docker-сети, на хост опубликованы 80/443. Логи ограничены по размеру. Системные Node.js, Caddy и systemd-сервисы не устанавливаются. Начальная конфигурация VPS: 1 vCPU / 1 ГБ RAM; это ориентир для закрытого пилота, не измеренная гарантия нагрузки.

## Rootless Docker и существующий reverse proxy

На rootless Docker не запускай встроенный Caddy: ему недоступны порты 80/443 без настройки администратора. Для уже распакованного архива добавь `compose.proxy.yaml` из репозитория рядом с compose.yaml. Затем от пользователя noon:

```sh
cd /home/noon/night-together/services/together
docker compose stop caddy
docker compose -f compose.yaml -f compose.proxy.yaml up -d --build together
curl -f http://127.0.0.1:8787/health
```

Этот вариант публикует только `127.0.0.1:8787`, а Caddy помещает в неактивный профиль standalone. При следующих запусках используй те же `-f` аргументы. Данные и имя проекта остаются прежними. Менять sysctl и выдавать привилегии RootlessKit не требуется.

Для nginx **на хосте** upstream — `http://127.0.0.1:8787`. В существующем HTTPS virtual host домена добавь `location / { proxy_pass http://127.0.0.1:8787; }`; сохрани его текущие сертификаты. Полный шаблон — deploy/nginx.conf.example, сертификатные директивы в него намеренно не включены. Для Caddy на хосте: `reverse_proxy 127.0.0.1:8787`. HTTPS завершает существующий proxy, а до сервиса идёт HTTP. WebSocket пока не используется.

Если proxy находится **в Docker**, его `127.0.0.1` относится к самому контейнеру. Если он запущен тем же Docker daemon, подключи его к сети `night-together_default` и укажи upstream `http://together:8787`. Если proxy работает в другом daemon (например, rootful proxy и rootless сервис noon), сеть между ними не общая: нужен доступ proxy к loopback хоста через его сетевую конфигурацию. Не меняй публикацию на `0.0.0.0`, чтобы не открыть API наружу без HTTPS.

После настройки proxy проверь `curl -f https://browser.night-watchers.com/health`; ожидается `{"ok":true}`. Адрес в браузере менять не нужно.

## Обновление и резервная копия

Повторно распакуй новый архив в тот же каталог и выполни `sudo docker compose up -d --build`. Данные находятся в volume `night-together_together_data` и сохраняются. Обычный `docker compose down` сохраняет volumes; `down -v` их удаляет.

Резервная копия с короткой остановкой сервиса:

```sh
sudo docker compose stop together
sudo docker run --rm -v night-together_together_data:/data:ro -v "$PWD":/backup alpine:3.22 tar czf /backup/night-together-backup.tgz -C /data .
sudo docker compose start together
sudo chmod 600 night-together-backup.tgz
```

Не публикуй backup и state.json: в них ключи доступа. Для восстановления останови together и распакуй копию в тот же volume с сохранением владельца файлов, затем запусти сервис.

Если HTTPS не работает, проверь DNS/AAAA, доступность портов и журнал Caddy. Публичный доступ к серверу из среды разработки был недоступен; установка на твоём VPS здесь не выполнялась.

Это основа закрытого пилота. Друзья и комнаты работают; автоматическая синхронизация плееров сайтов пока следующий этап. Для открытой массовой регистрации нужны дополнительная защита от ботов, мониторинг и процедура удаления/восстановления ID. Протокол и ограничения — docs/night/TOGETHER.md в архиве.


## Готовый HTTP-конфиг для proxy

`deploy/nginx.http.conf` — полный HTTP virtual host для browser.night-watchers.com на порту 80, с upstream 127.0.0.1:8787. Он проверяется настоящим `nginx -t` в контейнере без публикации портов. HTTPS снаружи в такой схеме обслуживает существующий внешний proxy.

Если при вставке nginx пишет `invalid number of arguments in proxy_pass`, проверь `sed -n '1,20l' /etc/nginx/sites-enabled/browser.conf`. Обратный слеш перед `;` экранирует конец директивы, и следующая строка становится её продолжением. Администратор от root может исправить этот конкретный случай:

```sh
sed -i 's/\;/;/g' /etc/nginx/sites-enabled/browser.conf
nginx -t && systemctl reload nginx
```

Файлы системного nginx редактирует администратор. Контейнер Together по-прежнему запускается от noon и публикуется только на 127.0.0.1:8787.
