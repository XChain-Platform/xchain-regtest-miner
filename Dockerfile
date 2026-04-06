FROM node:20-alpine

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

RUN mkdir -p /XChainRegtestMiner /data && chown -R nodejs:nodejs /XChainRegtestMiner /data

COPY ./package.json ./package-lock.json* /XChainRegtestMiner/
WORKDIR /XChainRegtestMiner
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=nodejs:nodejs ./src /XChainRegtestMiner/src

USER nodejs

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.request({hostname:'localhost',port:process.env.REGTEST_MINER_API_PORT||8080,method:'POST',headers:{'Content-Type':'application/json'}}, res => { process.exit(res.statusCode === 200 ? 0 : 1) }); req.write(JSON.stringify({jsonrpc:'2.0',method:'ping',id:1})); req.end();" || exit 1

CMD ["npm", "run", "api"]
