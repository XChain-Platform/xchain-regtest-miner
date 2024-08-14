FROM node:latest

RUN mkdir /XChainRegtestMiner/
RUN mkdir /data/
COPY ./package.json /XChainRegtestMiner/package.json
WORKDIR /XChainRegtestMiner
RUN npm install

COPY ./src /XChainRegtestMiner/src
COPY ./.en[v] /XChainRegtestMiner/.env

CMD ["npm", "run", "api"]