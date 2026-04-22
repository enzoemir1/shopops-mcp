FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY .well-known/ ./.well-known/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
