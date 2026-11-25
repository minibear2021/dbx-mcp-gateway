FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    MCP_GATEWAY_DATA_DIR=/app/gateway-data \
    MCP_GATEWAY_LISTEN_HOST=0.0.0.0 \
    MCP_GATEWAY_LISTEN_PORT=4225 \
    MCP_GATEWAY_PUBLIC_MCP_PATH=/mcp \
    MCP_GATEWAY_UPSTREAM_URL=http://dbx:4224 \
    MCP_GATEWAY_UPSTREAM_MCP_PATH=/mcp

WORKDIR /app
COPY plugins/mcp-token-gateway/package.json ./
COPY plugins/mcp-token-gateway/src ./src
COPY plugins/mcp-token-gateway/bin ./bin

RUN mkdir -p /app/gateway-data && chown -R node:node /app
USER node

EXPOSE 4225
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4225/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
