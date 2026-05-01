# Codeforces Daily Challenge

Смарт-контракт отвечает только за деньги и финальный статус периода: принимает депозит, хранит параметры challenge, хранит результат каждого периода, списывает штрафы и возвращает остаток депозита после завершения.

Проверка Codeforces вынесена в `backend/src/oracle.ts`, потому что контракт не может делать HTTP-запросы. Oracle читает `user.status`, анализирует submissions за конкретный период, сохраняет JSON proof в `proofs/` и вызывает контракт.

Главное правило проекта: засчитываются только Codeforces-задачи, у которых в API есть поле `problem.rating`. Даже `verdict = OK` не засчитывается, если рейтинг отсутствует или ниже `minRating`.

## Логика штрафов

- Нет ни одной отправки в периоде: `slashPeriodNoSubmission`, штраф 10 CHT.
- Отправки были, но нет подходящего `OK`: `slashPeriodNoOk`, штраф 5 CHT.
- Есть `OK` по задаче с `rating >= minRating`: `markPeriodCompleted`, штраф 0 CHT.

## Быстрый запуск локально

1. Установить зависимости:

```powershell
npm install
cd frontend
npm install
cd ..
```

2. Создать `.env` из `.env.example`.

```powershell
Copy-Item .env.example .env
```

3. Запустить локальную сеть Hardhat в отдельном терминале:

```powershell
npx hardhat node
```

4. Задеплоить токен и контракт во втором терминале:

```powershell
npm run deploy:local
```

Скрипт выведет `MockToken`, `CodeforcesDailyChallenge`, `Demo user`, `Oracle`, `Treasury`. В `.env` нужно вставить:

- `TOKEN_ADDRESS` = адрес `MockToken`;
- `CONTRACT_ADDRESS` = адрес `CodeforcesDailyChallenge`;
- `PRIVATE_KEY` = приватный ключ аккаунта oracle из вывода `npx hardhat node`.

5. Создать challenge:

```powershell
npm run create:challenge
```

По умолчанию демо-параметры такие: старт через 5 минут, 3 периода по 5 минут, `minRating = 800`, штрафы 10 и 5 CHT. Их можно поменять в `.env`.

6. После окончания каждого периода запустить oracle:

```powershell
npm run oracle -- --challenge=1 --period=0
npm run oracle -- --challenge=1 --period=1
npm run oracle -- --challenge=1 --period=2
```

Oracle создаст файлы proof в `proofs/` и отправит транзакцию в контракт.

7. Когда все периоды обработаны, вернуть остаток депозита пользователю:

```powershell
npm run withdraw:remaining -- --challenge=1
```

8. При необходимости вывести штрафы на treasury:

```powershell
npm run withdraw:treasury
```

## Фронтенд

Создать `frontend/.env.local` из примера:

```powershell
Copy-Item frontend\.env.local.example frontend\.env.local
```

Заполнить `VITE_CONTRACT_ADDRESS`, затем запустить:

```powershell
cd frontend
npm run dev
```

Открыть URL, который напечатает Vite, обычно `http://localhost:5173`.

## Проверка

```powershell
npx hardhat compile
npm test
npx tsc --noEmit
```

Если Hardhat пишет про lock в `compiler-download-list`, обычно уже запущен другой процесс Hardhat. Закрой параллельную компиляцию/тесты или подожди минуту и повтори команду.
