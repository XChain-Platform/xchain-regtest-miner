FROM node:22-alpine

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

RUN mkdir -p /XChainRegtestMiner /data && chown -R nodejs:nodejs /XChainRegtestMiner /data

COPY ./package.json ./package-lock.json* /XChainRegtestMiner/
WORKDIR /XChainRegtestMiner
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=nodejs:nodejs ./src /XChainRegtestMiner/src

USER nodejs

# Probes `health`, not `ping`: ping always answers 200 and reports wallet readiness
# only in its body, so a miner stalled on credential drift or an unreachable coin
# node stayed Docker-healthy. `health` 503s on a stall and treats a deliberate pause
# as healthy only once the mining loop has actually started, so a wedged
# prepareWallet cannot hide behind the same keepMining=false a pause sets.
# start-period tracks MINER_WALLET_GRACE_MS (default 60000), the window the probe
# itself forgives; raise both together on a venue whose wallet prep runs longer.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.request({hostname:'localhost',port:process.env.REGTEST_MINER_API_PORT||8080,method:'POST',headers:{'Content-Type':'application/json'}}, res => { process.exit(res.statusCode === 200 ? 0 : 1) }); req.write(JSON.stringify({jsonrpc:'2.0',method:'health',id:1})); req.end();" || exit 1

CMD ["npm", "run", "api"]
