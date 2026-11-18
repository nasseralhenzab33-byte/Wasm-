# وسم | WASM — صورة تشغيل (متوافقة مع Railway / Render / أي خادم Docker)
# ملاحظة: لا نستخدم VOLUME لأن Railway يرفضها؛ القرص الدائم يُركّب من لوحة المنصة على /data
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/data
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
