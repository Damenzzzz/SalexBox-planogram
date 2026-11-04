# Planogram Studio: статика и прокси на IR-сервис. Своих данных в контейнере нет.
#
#   docker build -t planogram-studio studio
#   docker run -p 8080:8080 -e IR_UPSTREAM=https://ir.apps.salesbox.kz planogram-studio
#
# Для сервера x86_64 с Apple Silicon: docker buildx build --platform linux/amd64 ...

# Сборка статики не зависит от платформы, поэтому идёт на платформе сборщика
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
# Адрес DNS берётся из /etc/resolv.conf контейнера: при перезапуске IR его новый IP подхватится сам
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY docker/05-check-ir-upstream.sh /docker-entrypoint.d/05-check-ir-upstream.sh
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
USER root
RUN rm -f /usr/share/nginx/html/*
USER 101
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz
