# CaseCellShop — Desafio Técnico (Júnior Fullstack)

Um mini-fluxo de checkout de capinhas de celular: o usuário escolhe um produto, informa a quantidade e tenta comprar. A ideia foi tratar bem os quatro desfechos que importam (compra concluída, entrada inválida, estoque insuficiente e ERP fora do ar), sempre com uma resposta clara pro usuário.

As respostas da parte conceitual estão em [`RESPOSTAS.md`](./RESPOSTAS.md), e os prompts de IA que usei ao longo do desafio em [`PROMPTS.md`](./PROMPTS.md).

## Stack

No back-end fui de Node.js + TypeScript com Express e Zod pra validação; os testes rodam em Vitest + Supertest. No front, React + TypeScript com Vite. Os dados (produtos e estoque) ficam em memória. Sem banco, autenticação, pagamento ou Docker, que estão fora do escopo do desafio.

## Como rodar

Você precisa do Node 18+ (de preferência uma versão LTS).

**Back-end** (porta 3001):
```bash
cd backend
npm install
npm run dev      # sobe a API em http://localhost:3001
npm test         # roda os testes
```

**Front-end** (porta 5173):
```bash
cd frontend
npm install
npm run dev      # abre em http://localhost:5173
```

Com os dois rodando, está tudo certo: o Vite faz proxy de `/api` para `http://localhost:3001`.

## API

A tabela abaixo descreve a API do back-end (porta 3001). No front, essas rotas são chamadas com o prefixo `/api`, que o proxy do Vite remove antes de repassar. Ou seja, `/api/products` no front chega como `/products` no back.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/products` | Lista produtos e estoque |
| POST | `/checkout` | Tentativa de compra |
| GET | `/health` | Status da API |
| POST | `/dev/erp` | Liga/desliga o ERP simulado (`{ "available": false }`) — só pra demo |

### `POST /checkout`

Request:
```json
{ "productId": "case-iphone-15", "quantity": 2, "idempotencyKey": "opcional" }
```

Possíveis respostas:

- `201` — compra concluída → `{ "order": { ... } }`
- `400 VALIDATION_ERROR` — entrada inválida
- `404 PRODUCT_NOT_FOUND` — produto não existe
- `409 INSUFFICIENT_STOCK` — sem estoque suficiente
- `503 ERP_UNAVAILABLE` — ERP fora ou lento; nesse caso a reserva de estoque sofre rollback

### Testando o cenário de ERP fora

Esse é o caso mais interessante de ver funcionando (o 503 com rollback). Dá pra reproduzir sem mexer no código: derruba o ERP simulado, tenta comprar e depois religa.

```bash
# desliga o ERP
curl -X POST http://localhost:3001/dev/erp \
  -H "Content-Type: application/json" \
  -d '{ "available": false }'

# tenta comprar → volta 503, e o estoque NÃO é consumido
curl -X POST http://localhost:3001/checkout \
  -H "Content-Type: application/json" \
  -d '{ "productId": "case-iphone-15", "quantity": 1 }'

# religa o ERP
curl -X POST http://localhost:3001/dev/erp \
  -H "Content-Type: application/json" \
  -d '{ "available": true }'
```

## Decisões e trade-offs

Procurei resolver cada coisa da forma mais simples que desse conta do escopo, deixando claro onde estão os limites. Abaixo, o raciocínio por trás de cada escolha e como ela evoluiria num cenário real.

**Dados em memória, sem banco.** Roda na hora e mantém o foco no que o desafio pede. O custo é óbvio: nada persiste e não dá pra escalar pra mais de uma instância. Em produção, produtos e estoque iriam pra um banco ou pra um serviço de estoque dedicado.

**Reserva de estoque com decremento síncrono antes de chamar o ERP.** Esse é o ponto que mata o furo de estoque (Problema 2): reservo o item antes de qualquer coisa, então não tem a janela de corrida onde dois checkouts vendem a mesma unidade. A ressalva honesta é que isso só é atômico dentro de um processo Node; com várias instâncias, o problema volta. O passo seguinte seria uma reserva atômica em Redis, ou uma fila serializada por produto.

**Idempotência por chave, guardada num `Map`.** Com pouca coisa, evito que um retry do cliente gere pedido e baixa duplicados. Em compensação, esse `Map` cresce indefinidamente e some quando o servidor reinicia. O jeito certo lá na frente é persistir a chave com TTL (Redis) e garantir um índice único no banco.

**ERP simulado com um toggle de disponibilidade** (em `erpClient.ts`, controlado pela rota `/dev/erp`). Foi o que me permitiu demonstrar o tratamento de indisponibilidade — o 503 com rollback — sem precisar de um ERP de verdade. Claro que ele não imita a latência nem o comportamento real, e esse toggle não existiria em produção; no lugar entraria um cliente HTTP com timeout, retry com backoff e circuit breaker.

**Faturamento síncrono no checkout.** Mantive simples de propósito, porque pro escopo fica mais fácil de entender. Mas é uma simplificação consciente: o cliente espera o ERP responder, e sob carga real isso traz de volta o risco de timeout (Problema 3). O caminho seria desacoplar — confirmar a reserva rápido e jogar o faturamento numa fila assíncrona.

**Preço em centavos** (`priceInCents`), pra fugir de erro de ponto flutuante com dinheiro. O preço disso é ter que dividir por 100 na hora de exibir, o que já está resolvido na borda da UI.

**Front com estado explícito** (`idle` / `loading` / `success` / `error`). Isso me dá o controle pra travar o botão enquanto a compra processa, evitando clique duplo, e pra mostrar uma mensagem adequada a cada tipo de erro. Custa um pouco mais de estado no componente; se a tela crescesse, eu extrairia isso pra um hook ou usaria react-query.

## Estrutura

```
backend/
  src/
    domain/products.ts          # produtos + estoque em memória (reserva/rollback)
    services/erpClient.ts       # ERP simulado (disponibilidade/latência)
    services/checkoutService.ts # regra de negócio do checkout
    app.ts                      # rotas Express + validação (Zod)
    index.ts                    # bootstrap do servidor
    __tests__/checkout.test.ts
frontend/
  src/
    App.tsx                     # tela de checkout
    api.ts                      # chamadas à API
    types.ts
```