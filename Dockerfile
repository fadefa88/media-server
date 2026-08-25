FROM node:22-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && ffmpeg -hide_banner -h full 2>&1 | grep -q 'readrate_initial_burst' \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY engine ./engine
COPY public ./public

ENV NODE_ENV=production
ENV PORT=4173

EXPOSE 4173

CMD ["node", "src/server.mjs"]
