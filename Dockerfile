FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY public/ ./public/
COPY server/ ./server/
COPY drizzle/ ./drizzle/
ENV PORT=80 DB_PATH=/data/bridge-lab.sqlite
EXPOSE 80
CMD ["node","server/node.mjs"]
