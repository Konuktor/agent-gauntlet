# Текст для озвучки

60 секунд, ~150 слов. Тайминги совпадают с промо-роликом
`agentgauntlet-promo.mp4` покадрово.

Читать спокойно и уверенно, без «презентационного» напора. Это инженерная
работа, а не реклама — тон должен быть как у человека, который показывает
коллеге найденную проблему.

---

## 0:00 – 0:04 · Холодный старт

> Ваш браузерный агент прошёл бенчмарк.
> Это почти ничего не говорит.

_Пауза после первой строки — секунда. Вторая строка тише и суше._

## 0:04 – 0:09 · Проблема

> Появляется баннер согласия. Модалка перехватывает фокус.
> Сессия истекает на середине задачи.

_Три коротких удара, ровным темпом. Не разгоняться._

## 0:09 – 0:14 · Продукт

> AgentGauntlet. Проверка на прочность до того, как это сделает продакшн.

## 0:14 – 0:20 · Как

> Одна и та же задача — в меняющихся условиях интерфейса, сети и сессии.
> На настоящих облачных браузерах Solari.

## 0:20 – 0:34 · Результат

> Базовый прогон — семь шагов. С баннером — семь.
> Неожиданная модалка тоже прошла. И заняла девятнадцать.
> А когда сессия истекла — агент не справился.

_«Девятнадцать» — главное слово ролика. Чуть выделить._

## 0:34 – 0:42 · Оценка

> Вердикт не приходит от агента. Он читается из состояния самого сайта,
> которое агент подделать не может.

## 0:42 – 0:50 · Песочница

> Свой агент — пожалуйста. Ваш репозиторий выполняется в изолированной
> песочнице Solari и получает доступ только к одному браузеру.
> Ключ от аккаунта он не видит никогда.

## 0:50 – 1:00 · Финал

> Четыре прогона — это демонстрация, а не бенчмарк.
> И продукт показывает доверительный интервал, чтобы об этом не забывали.

---

## English version

**0:00** Your browser agent passed its benchmark. That tells you almost nothing.
**0:04** A consent banner appears. A modal steals focus. The session expires mid-task.
**0:09** AgentGauntlet. Crash-test your browser agent before production does.
**0:14** The same task, under changing UI, network and session conditions — on real Solari cloud browsers.
**0:20** Baseline passes in seven steps. With the banner, seven. The unexpected modal also passed — and took nineteen. Then the session expired, and the agent failed.
**0:34** The verdict never comes from the agent. It is read from the site's own server-side state, which the agent cannot fake.
**0:42** Bring your own agent. Your repository runs inside an isolated Solari Sandbox and gets one scoped browser — never the account key.
**0:50** Four runs is a demonstration, not a benchmark. The product shows the confidence interval to say so.

---

## Как свести

```bash
# записали голос в voice.wav — накладываем на промо-ролик.
# -map выбирает потоки явно: у ролика уже есть тихая дорожка, и без -map
# ffmpeg может взять её вместо вашей.
ffmpeg -i docs/demo/agentgauntlet-promo.mp4 -i voice.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest \
  -y docs/demo/agentgauntlet-promo-vo.mp4
```

Если голос тише или громче фона — нормализуйте перед сведением:

```bash
ffmpeg -i voice.wav -af loudnorm=I=-16:LRA=11:TP=-1.5 -y voice-norm.wav
```

`-16 LUFS` — то, к чему приводят звук LinkedIn и X, так что ролик не будет
звучать тише соседних в ленте.

Если голос короче или длиннее — не растягивайте видео. Лучше подвиньте паузы
между репликами: у ролика в каждой сцене есть «воздух» именно под это.
