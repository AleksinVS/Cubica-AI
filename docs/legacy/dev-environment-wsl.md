# Архив: Разработка из WSL2

> Статус: архивировано 2025-10-03. Основная разработка ведётся на Windows; сценарий WSL хранится как перспективный.

Документ описывает рабочую схему, позволяющую параллельно использовать Windows-сессию и WSL2 при разработке Cubica. Используйте эти инструкции при подготовке WSL-окружения, если принято решение вернуть поддержку.

## Структура рабочих копий
- **Windows-клон**: `C:\Work\Tallent\Cubica`. Используется для PowerShell-скриптов, проверки `.ps1` и инструментов, завязанных на Windows.
- **WSL-клон**: `~/work/Cubica` (ext4). Используется для Linux-скриптов, Docker, CI-валидаций. Не редактируйте его через `/mnt/c`.
- Обе копии синхронизируются через Git. Перед переключением среды фиксируйте изменения (`git commit` или `git stash`).

## Базовая настройка WSL
- Дистрибутив: Ubuntu 22.04 LTS с включённым `systemd` (см. `/etc/wsl.conf`).
- Менеджеры версий: `nvm 0.39.7` (`node 20.11.0`, `npm 10.2.4`), системный `python3.10` + `pip3`, Docker Engine 28.4.0.
- После входа выполняйте `source ~/.nvm/nvm.sh && nvm use 20.11.0`, если автозагрузка не добавлена в `.bashrc`.
- Для Docker убедитесь, что пользователь состоит в группе `docker`; проверка — `docker run --rm hello-world`.

## Запуск скриптов
- Windows: `pwsh ./scripts/dev/bootstrap.ps1 -InstallDependencies -SeedData`.
- WSL: `INSTALL_DEPS=true SEED_DATA=true ./scripts/dev/bootstrap.sh`.
- Python-валидатор в WSL: `python3 scripts/ci/validate-legacy.py`.

## Рекомендации по синхронизации
- Избегайте одновременного редактирования одного и того же файла в двух средах.
- Настройте одинаковые `user.name`/`user.email` в Git для Windows и WSL, чтобы история не дробилась.
- Используйте `core.autocrlf=input` и `dos2unix` при необходимости для контроля концов строк.
- Перед запуском контейнеров в Windows убедитесь, что Docker Desktop не удерживает нужные порты, чтобы избежать конфликтов с WSL Docker Engine.

## Диагностика
- Проблемы с сетью в WSL: проверяйте `/etc/resolv.conf`, `ping archive.ubuntu.com`.
- Если Docker требует пароль: `sudo usermod -aG docker <user>` и `wsl --shutdown`.
- Для очистки WSL-копии используйте `git clean -fdx` внутри `~/work/Cubica`, не удаляя VHDX.
