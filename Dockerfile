# Rapport web service. No runtime dependencies: the server is plain Node.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY data/processed.json ./data/processed.json
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
