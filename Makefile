.PHONY: lint test

lint:
	pnpm run lint

test: lint
	pnpm run test:scripts
	pnpm run test:upgrader
