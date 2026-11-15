FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
RUN chmod 755 /app && chmod 644 /app/server.mjs && mkdir /data && chown node:node /data && chmod 700 /data
USER node
ENV HOST=0.0.0.0 PORT=8787 NIGHT_TOGETHER_DATA=/data/state.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
