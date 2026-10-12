FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.js store.js ./
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=3080 READER_DATA_DIR=/app/data
EXPOSE 3080
CMD ["node", "server.js"]
