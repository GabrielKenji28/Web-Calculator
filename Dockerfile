# syntax=docker/dockerfile:1

# Build context is the repository root: the frontend resolves
# contract/fixtures.json through its @contract alias.

# ---------- Stage 1: build the frontend ----------
FROM node:24-alpine AS frontend-build
WORKDIR /src/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY contract/ /src/contract/
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: build the service ----------
FROM golang:1.27-alpine AS backend-build
WORKDIR /src/backend

COPY backend/go.mod ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/calcserver ./cmd/server

# ---------- Stage 3: runtime ----------
FROM alpine:3.22

RUN adduser -D -u 10001 calc

WORKDIR /app
COPY --from=backend-build /out/calcserver /app/calcserver
COPY --from=frontend-build /src/frontend/dist /app/static

ENV STATIC_DIR=/app/static
ENV PORT=8080

USER calc
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/calcserver"]
