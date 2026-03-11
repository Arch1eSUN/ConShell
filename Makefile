.PHONY: install update doctor

install:
	@bash scripts/install.sh

update:
	@git pull origin main && pnpm install && pnpm build

doctor:
	@conshell doctor
