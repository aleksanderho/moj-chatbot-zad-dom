# Mój chatbot z odpowiedzią strumieniową

Chatbot w Next.js App Router i TypeScript. Korzysta z Vercel AI SDK 6
oraz `@openrouter/ai-sdk-provider`. Odpowiedzi pojawiają się strumieniowo,
a serwer otrzymuje historię bieżącej rozmowy. Historia znika po odświeżeniu strony.

## Uruchomienie lokalne

1. Zainstaluj Node.js 22 lub nowszy i wykonaj `npm ci`.
2. Skopiuj `.env.example` do `.env.local` i uzupełnij
   `OPENROUTER_API_KEY` oraz `OPENROUTER_MODEL`.
3. Wykonaj `npm run dev` i otwórz http://127.0.0.1:3000.

W PowerShell można używać `npm.cmd` zamiast `npm`.

## Bezpieczeństwo

Klucz API jest używany wyłącznie w serwerowym `app/api/chat/route.ts`.
Przeglądarka wysyła historię do `/api/chat`, bez klucza OpenRouter.
Pliki `.env*` są ignorowane przez Git; wyjątkiem jest pusty `.env.example`.
Nie należy dodawać prefiksu `NEXT_PUBLIC_` do zmiennych OpenRouter.

## Krótki opis testu

Test automatyczny (`node --test tests/chat.test.mjs`) używa lokalnej atrapy
OpenRouter, bez płatnych wywołań. Sprawdza odbiór fragmentów strumienia,
dwie kolejne wiadomości przez klienta AI SDK, przekazanie historii,
odrzucanie pustych wiadomości oraz bezpieczne komunikaty błędów.
Sprawdzenie produkcyjnego builda: `npm run build`.

Test ręczny po publikacji: wyślij „Mam na imię Ola”, a potem „Jak mam na imię?”.
Sprawdź zachowanie kontekstu. Poproś też o dłuższą odpowiedź i sprawdź,
czy tekst pojawia się stopniowo. Ten test wymaga skonfigurowanego konta OpenRouter.

## Publikacja na Vercel

Zaimportuj to repozytorium jako projekt Next.js. W Environment Variables
ustaw `OPENROUTER_API_KEY` i `OPENROUTER_MODEL` dla Production.
Klucz wpisz bezpośrednio w Vercel, nigdy w repozytorium.
Polecenie budowania: `npm run build`; katalog główny projektu: `./`.
Po zmianie zmiennych wykonaj nowy deployment.
