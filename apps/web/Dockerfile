# Contexto de build: raiz do repositório
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/web --include-workspace-root
COPY apps/web apps/web
# Endereço interno da API, usado nos rewrites (lido no build) e no servidor
ARG API_URL
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/web
WORKDIR /app/apps/web
CMD ["sh", "-c", "npx next start -p ${PORT:-3000} -H ::"]
