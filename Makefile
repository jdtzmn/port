.PHONY: ubuntu down

ubuntu:
	docker compose up -d samples && docker compose exec samples bash

down:
	docker compose down
