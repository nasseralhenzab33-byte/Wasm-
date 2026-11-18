FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_FILE=/data/wasm.db UPLOAD_DIR=/data/uploads
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN addgroup -S wasm && adduser -S wasm -G wasm && mkdir -p /data && chown wasm:wasm /data
USER wasm
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
