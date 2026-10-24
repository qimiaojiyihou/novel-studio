FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.js store.js network-library.js source-fetch.js source-rules.js source-expression.js source-xpath.js source-script.js source-script-worker.js source-runtime.js source-state.js source-auth.js source-authorization.js source-request.js source-browser.js source-regex.js source-redirect.js default-sources.json ./
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=3080 READER_DATA_DIR=/app/data
EXPOSE 3080
CMD ["node", "server.js"]
