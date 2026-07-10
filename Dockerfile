FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY dist ./dist

EXPOSE 9000

CMD ["node", "dist/cloud-functions/web-server.js"]
