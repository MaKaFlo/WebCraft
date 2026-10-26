# WebCraft web container: builds the game page and serves it with nginx.
# nginx also forwards /ws to the WebCraft plugin on the Minecraft server (so https pages can use wss://).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY build.mjs ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/index.html /usr/share/nginx/html/index.html
EXPOSE 80
