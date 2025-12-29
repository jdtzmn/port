.PHONY: ubuntu

ubuntu:
	docker compose up -d samples && docker compose exec samples bash
