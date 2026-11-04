# Запуск Planogram Studio рядом с IR

Studio — это контейнер nginx со статикой интерфейса. Он отдаёт страницы и пересылает `/v1/*` на
IR-сервис. Базы, тома и своего API у него нет: планограммы, назначения и мониторинг хранит IR.

```
Браузер → planogram.apps.salesbox.kz (этот контейнер)
            ├─ /, /assets/*    интерфейс
            ├─ /healthz        ответ самого nginx
            └─ /v1/*, /readyz  IR-сервис
```

## Что нужно от IR

Без этого Studio откроется, но работать не будет.

1. **Версия:** образ `registry.apps.salesbox.kz/salesbox/salesbox-ir:main`, коммит `81bdd3a` или новее.
   В старых версиях нет `/v1/planograms` и `/v1/studio/*`.
2. **Постоянный том на `/data`:** там лежат `studio.sqlite` и `api.sqlite`. Без тома все планограммы
   пропадут при первом перезапуске.
3. **Одна реплика:** очередь и SQLite живут внутри одного процесса.
4. **Ресурсы:** минимум 2 vCPU, 4 ГБ памяти и 20 ГБ на `/data`; лучше 4 vCPU, 6 ГБ и 50 ГБ. Оценка
   скорости: примерно 5 с на фото на 2 vCPU, фото обрабатываются по одному.

В `:main` нет `GET /v1/photos/{id}/original`: оригиналы фото больше не хранятся. Перед обновлением
проверьте, что этим адресом никто не пользуется.

## Контейнер Studio

| Параметр | Значение |
|---|---|
| Образ | `registry.apps.salesbox.kz/salesbox/salesbox-ir/planogram-studio:main`, linux/amd64 |
| Порт | 8080, процесс не от root |
| CPU | запрос 0.1, лимит 0.5 |
| Память | запрос 64 МБ, лимит 256 МБ |
| Диск и том | не нужны |
| Реплики | 1, можно больше |

Единственная обязательная настройка — `IR_UPSTREAM`, адрес IR без пути и без `/` в конце. Без неё
контейнер не стартует и пишет причину в лог. Если сервисы стоят рядом, лучше внутренний адрес: фото
не пойдут через внешний прокси.

```bash
docker run -d --name planogram-studio --restart unless-stopped -p 8080:8080 \
  -e IR_UPSTREAM=http://ir:8000 \
  registry.apps.salesbox.kz/salesbox/salesbox-ir/planogram-studio:main
```

```yaml
services:
  planogram-studio:
    image: registry.apps.salesbox.kz/salesbox/salesbox-ir/planogram-studio:main
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      IR_UPSTREAM: http://ir:8000
    mem_limit: 256m
    cpus: 0.5
```

На входящем прокси перед контейнером: HTTPS, тело запроса до 32 МБ, таймаут от 120 с. Заголовок
HSTS контейнер не ставит, это дело прокси.

## Эндпоинты

| Адрес | Что делает |
|---|---|
| `GET /` | интерфейс, без кэша |
| `GET /assets/*` | файлы сборки, кэш на год |
| `GET /healthz` | проверка для оркестратора, от IR не зависит |
| `GET /readyz` | ответ IR: проверка связи вручную |
| `/v1/*` | пересылается в IR без изменений, вместе с заголовками ключа |

Контейнер не хранит ключ API. Его вводит человек в окне «Подключить», там же указываются клиент и имя.

## Проверка после запуска

```bash
curl https://planogram.apps.salesbox.kz/healthz          # {"status":"ok"}
curl https://planogram.apps.salesbox.kz/readyz           # {"status":"ready"}: связь с IR есть
curl -i https://planogram.apps.salesbox.kz/v1/planograms # 401: IR новой версии, без ключа не пускает
```

Если последний запрос отвечает 404, на IR ещё старая версия. Ответ 502 значит, что контейнер не
достучался до `IR_UPSTREAM`.

## Перенос данных

Готовые шкафы, планограммы и назначения лежат одним файлом в проекте `salesbox/salesbox-ir`: раздел
Deploy → Package registry, пакет `planogram-studio-data`, версия `2026.11.4`. Учётных записей и
сессий в нём нет.

Перенос делается один раз, пока в Studio на новом сервере ещё никто не работал:

```bash
curl --header "PRIVATE-TOKEN: <токен с read_api>" -O \
  https://gitlab.apps.salesbox.kz/api/v4/projects/21/packages/generic/planogram-studio-data/2026.11.4/studio-export.sqlite.gz
shasum -a 256 studio-export.sqlite.gz
# 249bcde66f37080c98dd30955e6c63c0b6aea1e22205c0d02a2ce9628d96a117
gunzip studio-export.sqlite.gz
```

1. Остановить IR.
2. Положить файл в том `/data` под именем `studio.sqlite`, владелец — uid 10001. Если там уже есть
   `studio.sqlite-wal` и `studio.sqlite-shm`, удалить их.
3. Запустить IR.

Файл `api.sqlite` не трогать: в нём фото самого сервиса.

## Обновление

Собрать из этого репозитория и выложить образ:

```bash
docker buildx build --platform linux/amd64 --push \
  -t registry.apps.salesbox.kz/salesbox/salesbox-ir/planogram-studio:main studio
```

Затем скачать новый образ на сервере и пересоздать контейнер. Данные при этом не затрагиваются,
они в IR.
