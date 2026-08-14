.PHONY: all dev worker build test typecheck lint db-generate db-migrate spike clean

all: build

dev:
	npm run dev

worker:
	npm run worker

build:
	npm run build

test:
	npm run test

typecheck:
	npm run typecheck

lint:
	npm run lint

db-generate:
	npx prisma generate

db-migrate:
	npx prisma migrate dev

db-seed:
	npx prisma db seed

spike:
	npx tsx scripts/spike-linkedin.ts

clean:
	rm -rf .next dist coverage
