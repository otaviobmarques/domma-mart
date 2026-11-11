# Contexto de build: raiz do repositório
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w apps/api
WORKDIR /app/apps/api
# Migrações sempre; dados de demonstração só se SEED_DEMO=1 (homologação)
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DEMO\" = \"1\" ]; then node dist/seed.js; fi && node dist/main.js"]
