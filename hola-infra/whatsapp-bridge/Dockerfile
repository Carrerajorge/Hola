
FROM node:22-slim

# Baileys (o alguna dependencia) necesita git para instalar deps desde git urls
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
EXPOSE 9106
CMD ["node", "index.mjs"]
