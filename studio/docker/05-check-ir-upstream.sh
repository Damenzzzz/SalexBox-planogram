#!/bin/sh
# Без адреса IR контейнер не стартует: иначе интерфейс откроется, а все запросы будут падать.
fail() {
  echo "IR_UPSTREAM: $1. Пример: IR_UPSTREAM=https://ir.apps.salesbox.kz или http://ir:8000" >&2
  exit 1
}

case "${IR_UPSTREAM:-}" in
  "") fail "переменная не задана" ;;
  http://*|https://*) ;;
  *) fail "адрес должен начинаться с http:// или https://" ;;
esac

case "${IR_UPSTREAM#*://}" in
  */*) fail "нужен адрес без пути и без / в конце" ;;
esac
