FROM oven/bun:1.3.13
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=bun:bun src ./src
USER bun
EXPOSE 8787
ENTRYPOINT ["bun", "src/cli.ts"]
CMD ["serve", "--config", "/config/server.json"]
