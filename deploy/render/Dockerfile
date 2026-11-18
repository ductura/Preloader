# Optional image of the Preloader for Render (docs/DEPLOY.md); ductura.org runs
# on Vercel (vercel.json). Kept out of the repository root on purpose: a root
# Dockerfile can switch the Vercel project to its Container preset.
# Build from the repository root: `docker build -f deploy/render/Dockerfile .`
#
# `build` runs `pnpm build` and writes the CSP map of the built pages; the final
# stage is unprivileged nginx (uid 101) serving dist/ on $PORT and proxying
# /admin, /api/v1 and /app/* like vercel.json. The three upstream URLs come
# from the environment at start (APLICATION_FRONT_URL, INSTITUTION_SERVER_URL,
# INSTITUTION_FRONT_URL); without them nginx does not start. No secret here.
FROM mirror.gcr.io/library/node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS build
WORKDIR /src
RUN npm install --global pnpm@10.33.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && node deploy/render/csp-map.ts dist csp-map.inc

FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY --from=build /src/dist /usr/share/nginx/html
COPY --from=build /src/csp-map.inc /etc/nginx/conf.d/csp-map.inc
COPY deploy/render/default.conf.template /etc/nginx/templates/default.conf.template
# Default only; Render sets its own PORT.
ENV PORT=8080
EXPOSE 8080
USER 101
