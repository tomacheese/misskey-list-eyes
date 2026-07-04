FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

# hadolint ignore=DL3018
RUN apk update && \
  apk upgrade && \
  npm install -g corepack@latest && \
  corepack enable

WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

COPY tsconfig.json ./
COPY src src

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

FROM zenika/alpine-chrome:with-puppeteer-xvfb AS runner

# hadolint ignore=DL3002
USER root

# hadolint ignore=DL3018
RUN apk upgrade --no-cache --available && \
  apk update && \
  apk add --no-cache \
  x11vnc \
  && \
  apk add --update --no-cache tzdata && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  apk del tzdata

WORKDIR /app

# puppeteer-core@25.2.1 は ESM 専用パッケージであり、ランナーに同梱の Node.js (v20.15.1) では
# require() による同期解決に対応していないため、builder ステージの Node.js 24 系バイナリを利用する
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

# builder ステージから必要なファイルのみをコピー
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV TZ=Asia/Tokyo
ENV DISPLAY=:99
ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV NOTIFIED_PATH=/data/notified.json

ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
