# Night Together через Docker

На сервере нужны Docker Engine и Docker Compose v2. Установка Docker: https://docs.docker.com/engine/install/ . Системный Node.js не нужен.

В DNS создай `A browser.night-watchers.com → 144.91.104.48`. Убери неправильную AAAA-запись, если она есть. Открой входящие TCP 80 и 443 в панели хостинга/firewall; не открывай 8787. Для первого запуска удобно отключить proxy/CDN и направить домен прямо на сервер. Caddy автоматически получает сертификат и перенаправляет HTTP на HTTPS.

## Запуск

```sh
curl -fL https://github.com/1atex/night-browser/releases/download/v0.13.0-preview.4/night-together-server-0.13.0.zip -o /tmp/night-together.zip
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

## Если 80/443 уже заняты

Не останавливай чужие сайты. Используй существующий reverse proxy: подключи его к сети `night-together_default` и направь домен на `together:8787`; контейнер caddy тогда не запускай (`docker compose up -d --build together`). При reverse proxy вне Docker можно отдельным compose override опубликовать только `127.0.0.1:8787:8787` для together и проксировать на localhost. Сертификат обслуживает существующий proxy.

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
