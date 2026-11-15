FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node_modules/.bin/tsx", "src/index.ts"]
