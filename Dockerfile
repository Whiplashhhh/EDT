# Image unique : le serveur Node sert l'API et le front compilé.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist

# Les abonnements aux notifications push sont la seule chose que le service
# écrive sur disque. Sans volume, ils disparaîtraient à chaque remplacement du
# conteneur et les téléphones cesseraient d'être prévenus, sans rien signaler.
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
VOLUME ["/app/server/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
