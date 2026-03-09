
FROM node:22-slim AS build

WORKDIR /app

COPY package.json tsconfig.json ./

RUN npm install

COPY src ./src

RUN npm run build



FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/dist ./dist

COPY --from=build /app/package.json ./package.json

CMD ["node", "dist/index.js"]

