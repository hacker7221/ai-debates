# Web-сервис “AI Debates” — подробное описание и инструкция по реализации (Python backend + Vite/React frontend + OpenRouter)

Цель: создать веб-сервис, где пользователь выбирает 2+ ИИ-моделей (дебатёров) и модель-модератор, задаёт тему, запускает “живой” дебат и наблюдает его в браузере в текстовом виде (со стримингом реплик).  
Провайдер моделей: OpenRouter (единая точка доступа к множеству моделей).  
Фронтенд: Vite + React.  
Бэкенд: Python (FastAPI) + Postgres + Redis (очередь и стриминг событий).

--------------------------------------------------------------------

## 1) Ключевые требования (MVP)

### Функциональные
1) Пользователь может:
   - выбрать тему (prompt)
   - выбрать 2–5 “дебатёров” (каждому: модель + персона/стиль)
   - выбрать модератора (модель)
   - выбрать формат дебатов (пресет)
   - настроить “бурность” (интенсивность) и длину (коротко/средне/длинно)
   - запустить дебат и смотреть его в реальном времени
2) Дебат идёт по строгому регламенту:
   - раунды и очередь (round-robin)
   - лимиты длины ответа (по словам)
   - при нарушении формата/лимитов выполняется ретейк (переписывание)
3) Результаты сохраняются и доступны по ссылке:
   - просмотр истории дебата
   - экспорт JSON (и опционально Markdown позже)

### Нефункциональные
1) Предсказуемая стоимость:
   - ограничение числа ходов, моделей, токенов, длины контекста
   - квоты/лимиты на пользователя
2) Безопасность:
   - фильтрация запрещённого контента
   - защита от злоупотреблений
3) Надёжный стриминг:
   - UI получает события по SSE (server-sent events)
4) Масштабируемость:
   - генерация дебатов вынесена в воркеры (job queue)
   - API-сервер не блокируется долгими генерациями

--------------------------------------------------------------------

## 2) Пользовательские сценарии

### 2.1 Создание дебата
1) Пользователь открывает страницу Create Debate
2) Выбирает:
   - Topic
   - Debaters (2–5): модель + персона
   - Moderator: модель
   - Preset: формат (например “Classic 6 rounds”)
   - Length preset: short/medium/long
   - Intensity: 1–10
3) Нажимает Start
4) UI получает debate_id и автоматически подключается к стриму

### 2.2 Просмотр “живого” дебата
1) UI подписывается на SSE поток /debates/{id}/stream
2) Сервер отправляет события:
   - debate_started
   - round_started
   - turn_started
   - turn_delta (кусочки текста)
   - turn_completed (финальная реплика)
   - debate_completed
3) UI визуализирует:
   - карточки участников с подсветкой говорящего
   - ленту сообщений (чат)
   - прогресс по раундам и ходам

### 2.3 Просмотр завершённого дебата
1) Открытие /debates/{id}
2) UI запрашивает /debates/{id} и рисует все turns
3) Кнопка Export JSON

--------------------------------------------------------------------

## 3) Архитектура системы (высокоуровнево)

Компоненты:
1) Frontend (Vite + React)
2) Backend API (FastAPI):
   - управление пользователями и сессиями
   - CRUD дебатов
   - SSE endpoint для стриминга
3) Worker (Debate Orchestrator):
   - выполняет дебат по раундам
   - вызывает модели через OpenRouter
   - публикует события в Redis Pub/Sub
   - сохраняет финальные turns в Postgres
4) Postgres:
   - debates, turns, users, quotas, presets
5) Redis:
   - очередь задач (job queue)
   - pub/sub канал событий по debate_id
   - rate-limit счетчики
6) OpenRouter:
   - единый API для вызова разных моделей

Потоки данных:
- Frontend -> API: создать дебат
- API -> Redis Queue: поставить job на выполнение
- Worker -> OpenRouter: генерация
- Worker -> Redis Pub/Sub: события стриминга
- API SSE -> Redis Pub/Sub: подписка и ретрансляция в браузер
- Worker -> Postgres: сохранение финальных реплик

--------------------------------------------------------------------

## 4) Модель дебатов: роли, регламент, контроль

### 4.1 Роли
- Moderator: открывает/закрывает раунды, держит темп, подводит итоги
- Debaters (2–5): участники с персоной (стиль аргументации)
- Timekeeper/Validator: компонент контроля (в MVP лучше локально, правилами), который:
  - проверяет формат (строго JSON)
  - проверяет длину (word_count)
  - проверяет токсичность/запрещенные элементы (минимально)
  - запускает ретейк

Примечание: Timekeeper можно реализовать без отдельной модели, чтобы экономить. Для MVP: локальная валидация + простые фильтры, и ретейк делается тем же дебатёром.

### 4.2 Формат (пресет “Classic 6 rounds”)
1) Moderator opening
2) Opening statements (по кругу)
3) Rebuttal round 1 (по кругу)
4) Cross-exam: вопрос-ответ по кругу
5) Rebuttal round 2 (по кругу)
6) Closing statements (по кругу)
7) Moderator summary

### 4.3 Контроль длины
Поскольку “секунды” модели не чувствуют, используем лимит по словам:
- short: 25–40 слов (opening), 20–35 (rebuttal)
- medium: 45–60 (opening), 35–50 (rebuttal)
- long: 70–95 (opening), 55–75 (rebuttal)

### 4.4 Контекстная политика (снижение стоимости)
- В каждом ходе даём:
  - последние N реплик (например 6–10)
  - краткое summary (например 120 слов), обновляемое после каждого хода
- Не передаём всю историю дебата целиком.

### 4.5 Ретейки
Правило:
- Если реплика нарушает формат/лимит/запрещенный контент:
  - выдать instruction “Перепиши строго в X–Y слов, без …”
  - максимум 2 ретейка
- Если не получилось:
  - вставить безопасную fallback-реплику (короткую и нейтральную) и продолжить дебат или завершить с error, в зависимости от политики.

--------------------------------------------------------------------

## 5) Формат данных: CONFIG и TURN (строго)

### 5.1 DebateConfig (хранится в БД как JSON)
Поля:
- episode_id (генерируется)
- title
- language
- topic.prompt
- topic.constraints (правила безопасности)
- participants:
  - moderator: provider_model_id, display_name
  - debaters: список {id, display_name, provider_model_id, persona_preset, persona_custom}
- debate_preset_id
- length_preset (short/medium/long)
- intensity (1–10)
- limits:
  - max_turns_total
  - max_tokens_per_turn
  - max_retake_attempts
- context_policy:
  - max_recent_turns
  - summary_max_words
- ui_preferences:
  - show_token_stream true/false (для turn_delta)

### 5.2 TurnOutput (сохраняется как запись turns)
Каждый “ход” должен быть строго структурирован:
- debate_id
- seq_index
- round_id
- turn_type (opening_statement | rebuttal | question | answer | closing | moderator_segment)
- speaker_id
- speaker_name
- text
- word_count
- created_at
- model_used (provider_model_id)
- usage: tokens_in, tokens_out, cost_estimate (если доступно)
- retake_count
- validation_flags (json)

--------------------------------------------------------------------

## 6) API бэкенда (FastAPI)

### 6.1 Auth (MVP)
Варианты:
- Анонимные сессии (session_id cookie) + лимиты по IP/сессии
- Или полноценный login (email + пароль) и JWT

Для MVP обычно достаточно:
- session-based идентификатор
- rate limiting по session_id и IP

### 6.2 Endpoints (минимум)

1) GET /models
- Возвращает список поддерживаемых моделей (из вашего allowlist)
- Поля: id, display_name, capabilities (context_length примерно), tags

2) GET /presets
- Возвращает форматы дебатов и лимиты

3) POST /debates
- Создаёт дебат
- Принимает DebateConfig (без episode_id)
- Возвращает {debate_id, status}

4) GET /debates/{debate_id}
- Возвращает метаданные и список turns (или пагинацию)

5) GET /debates/{debate_id}/stream  (SSE)
- Стримит события по дебату:
  - event: debate_started
  - event: round_started
  - event: turn_started
  - event: turn_delta
  - event: turn_completed
  - event: debate_completed
  - event: error

6) POST /debates/{debate_id}/stop  (опционально)
- Ставит флаг остановки (worker должен периодически проверять)

--------------------------------------------------------------------

## 7) SSE события (контракт для фронтенда)

События (пример payload-структур):

1) debate_started
- {debate_id, started_at, participants}

2) round_started
- {round_id, round_type, index}

3) turn_started
- {seq_index, round_id, speaker_id, speaker_name, turn_type}

4) turn_delta
- {seq_index, delta_text}

5) turn_completed
- {seq_index, round_id, speaker_id, turn_type, text_final, word_count}

6) debate_completed
- {ended_at, total_turns, totals: {tokens_in, tokens_out, cost_estimate}}

7) error
- {code, message, recoverable}

Поведение UI:
- turn_delta отображается как “печатается…”
- после turn_completed UI фиксирует финальный текст

--------------------------------------------------------------------

## 8) Worker (Debate Orchestrator): детальная логика

### 8.1 Последовательность исполнения
1) Получить DebateConfig из БД
2) Записать status=running
3) Опубликовать debate_started
4) Для каждого раунда по preset:
   - опубликовать round_started
   - определить порядок спикеров
   - для каждого хода:
     - собрать контекст (последние N turns + summary)
     - сформировать prompt
     - вызвать OpenRouter (streaming):
       - по мере поступления токенов публиковать turn_delta
     - получить полный текст
     - провалидировать (формат/слова/запреты)
     - если нужно: ретейк
     - сохранить turn в БД
     - опубликовать turn_completed
     - обновить summary
5) status=completed
6) опубликовать debate_completed

### 8.2 Связка Worker -> SSE
Worker публикует события в Redis Pub/Sub канал:
- channel: debate:{debate_id}

API SSE endpoint:
- подписывается на этот канал
- пробрасывает сообщения в браузер в формате SSE

### 8.3 Очередь задач
Используйте Redis queue. Практичные варианты:
- RQ (простая интеграция)
- Celery (мощнее, но тяжелее)

Для MVP рекомендуется RQ:
- минимальная конфигурация
- удобно запускать отдельным процессом

--------------------------------------------------------------------

## 9) Интеграция с OpenRouter (концептуально)

Стратегия:
- Вы храните у себя allowlist моделей (то, что показываете пользователю)
- На каждый вызов модели вы отправляете:
  - system prompt (роль: moderator / debater)
  - user prompt (текущий раунд, лимит, контекст)
  - параметры генерации:
    - temperature зависит от intensity
    - max_tokens зависит от length preset
    - streaming включен для turn_delta

Важно:
- OpenRouter даёт унифицированный доступ, но вы обязаны:
  - жёстко ограничивать max_tokens
  - ограничивать количество ходов
  - ограничивать число участников

--------------------------------------------------------------------

## 10) Безопасность, квоты и контроль затрат

### 10.1 Ограничения (обязательные для MVP)
- max_debaters: 5
- max_turns_total: например 60 (включая модератора)
- max_tokens_per_turn: например 250–600 (в зависимости от length)
- max_context_turns: 10
- summary_max_words: 120–180

### 10.2 Rate limiting
- Ограничение на создание дебатов: например 5/час на сессию
- Ограничение на параллельные дебаты: 1–2 одновременно
- Ограничение на общий токен-бюджет в сутки (если можете считать)

### 10.3 Модерация/валидация
Минимум:
- блок-лист явных запрещенных паттернов
- ограничение токсичности (упрощённо)
- запрет на PII (хотя бы простые эвристики)

Политика при нарушениях:
- ретейк с “смягчи формулировки, соблюдай правила”
- при повторе: завершить дебат с error и показать причину пользователю

--------------------------------------------------------------------

## 11) Фронтенд (Vite + React): структура и экраны

### 11.1 Страницы
1) Home / Create Debate
- форма выбора темы, моделей, пресета, длины, интенсивности
- кнопка Start

2) Debate Live
- подключение к SSE
- карточки участников
- лента реплик
- прогресс-бар раундов
- кнопка Stop

3) Debate View (History)
- список реплик
- экспорт JSON

### 11.2 Состояние UI
- debate meta
- turns array
- active_turn (если стримится)
- connection status (connected/reconnecting/error)

### 11.3 Визуализация “красиво” без видео
- карточки участников с аватаром (плейсхолдер)
- подсветка активного спикера
- анимация “typing” при turn_delta
- возможность свернуть/развернуть длинные реплики

--------------------------------------------------------------------

## 12) База данных (Postgres): минимальная схема

Таблица users (опционально для MVP, можно заменить на sessions):
- id
- email (nullable)
- created_at

Таблица sessions (для анонимных пользователей):
- id
- created_at
- last_seen_at

Таблица debates:
- id (uuid)
- session_id / user_id
- status (queued/running/completed/error/stopped)
- title
- config_json
- created_at, started_at, ended_at
- totals_json (tokens, cost, turns)

Таблица turns:
- id (uuid)
- debate_id
- seq_index (int)
- round_id
- turn_type
- speaker_id
- speaker_name
- text
- word_count
- model_used
- usage_json
- retake_count
- created_at

Таблица presets:
- id
- name
- preset_json

Индексы:
- turns(debate_id, seq_index)
- debates(session_id, created_at)

--------------------------------------------------------------------

## 13) Репозиторий и структура проекта (рекомендация)

monorepo/
  backend/
    app/
      main.py
      api/
        routes_models.py
        routes_presets.py
        routes_debates.py
        routes_stream.py
      core/
        config.py
        security.py
        rate_limit.py
        redis.py
        db.py
      services/
        orchestrator.py
        prompt_builder.py
        context_manager.py
        validators.py
        openrouter_client.py
        summary_manager.py
        events.py
      models/
        sqlalchemy_models.py
      migrations/ (alembic)
    worker/
      worker_main.py
      rq_setup.py
  frontend/
    src/
      pages/
      components/
      api/
      hooks/
      styles/

--------------------------------------------------------------------

## 14) План реализации по шагам (чётко)

Шаг 1: Skeleton
- Создать FastAPI проект, подключить Postgres (SQLAlchemy) и Alembic
- Поднять Redis
- Создать базовые таблицы debates/turns/sessions

Шаг 2: Каталог моделей и пресеты
- Реализовать /models (allowlist)
- Реализовать /presets (форматы и лимиты)

Шаг 3: Создание дебата и постановка в очередь
- POST /debates:
  - валидировать конфиг
  - создать запись debates со статусом queued
  - enqueue job в Redis queue

Шаг 4: Worker orchestration
- Воркера запускать отдельным процессом
- Реализовать orchestrator:
  - выполнение раундов
  - вызов openrouter_client с streaming
  - публикация событий в Redis pub/sub
  - сохранение turn в БД

Шаг 5: SSE endpoint
- /debates/{id}/stream:
  - подписка на Redis pub/sub канал debate:{id}
  - выдача событий браузеру

Шаг 6: Frontend live view
- Страница Create Debate:
  - выбрать модели/модератора/пресет
  - старт -> переход на /debates/{id}/live
- Страница Live:
  - EventSource на /stream
  - рендер карточек и ленты
  - подсветка активного спикера
- Страница History:
  - GET /debates/{id}

Шаг 7: Лимиты и безопасность
- Ввести max_turns_total, max_tokens_per_turn
- Валидация длины по словам
- Ретейки
- Rate limiting на создание дебатов

Шаг 8: Полировка
- Экспорт JSON
- Кнопка Stop
- Улучшение summary и контекста
- Логи и мониторинг

--------------------------------------------------------------------

## 15) Промпты (стандартизированные) и управление “бурностью”

Вы используете один базовый system prompt на роль и динамические user prompts.

Intensity (1–10) влияет на:
- temperature: условно 0.3–1.1
- стиль: “спокойно” -> “бурно, но уважительно”
- выбор лексики: более короткие фразы и больше контраргументов при высокой интенсивности

Важное правило: несмотря на бурность, всегда запрещены:
- оскорбления
- ненависть/дискриминация
- призывы к насилию
- раскрытие персональных данных

--------------------------------------------------------------------

## 16) Деплой (MVP)

Рекомендуемая минимальная конфигурация:
- backend API (uvicorn/gunicorn)
- worker процесс (RQ worker)
- Redis
- Postgres

Размещение:
- один VPS или облачный инстанс
- далее масштабирование:
  - несколько worker-ов
  - отдельный Redis
  - managed Postgres

Логи:
- сохранять ошибки генерации и события в структурированном виде
- хранить totals по токенам и ходам для контроля бюджета

--------------------------------------------------------------------

## 17) Что получится в результате (MVP deliverables)

1) Web UI:
- создание дебата
- live-дебат со стримингом текста
- просмотр истории
- экспорт JSON

2) Backend:
- API для моделей/пресетов/дебатов
- SSE стриминг
- worker оркестратор
- OpenRouter интеграция
- базовые лимиты и защита бюджета

--------------------------------------------------------------------

## 18) Следующий логичный апгрейд после MVP

- “Share link” и публичные дебаты (read-only)
- Рейтинг “кто победил” (judge модель) с объяснением
- Авто-резюме и “лучшие моменты”
- Подключение TTS и генерация видео как отдельный платный экспорт
- Пользовательские вмешательства в середине дебата (задавать вопрос)