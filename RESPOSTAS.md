# Parte 1.A — Respostas Conceituais

## Pergunta 1 — Leitura inicial dos problemas

### 01 | Performance da vitrine

Na minha leitura, o problema começa no fato de a vitrine ler produto, preço e estoque direto do ERP a cada acesso, via API síncrona. O ERP é um monolito on-premise pensado pra operação interna, não pra aguentar tráfego de e-commerce — então com milhões de acessos cada visita vira uma ou mais queries no MySQL dele, e ele satura. Como não tem cache no meio, dados que quase não mudam (catálogo, preço) são buscados de novo o tempo todo sem necessidade.

O impacto é direto na receita: o cliente abandona logo na primeira tela, e a conversão cai. Tem um agravante: como faturamento e financeiro rodam no mesmo monolito, a sobrecarga da vitrine acaba respingando neles.

Primeiro passo que eu daria: medir onde o tempo está sendo gasto — latência do ERP, rede ou renderização — antes de sair otimizando no escuro. A partir daí, colocar uma camada de cache/leitura pro catálogo, servindo a vitrine sem bater no ERP em toda request.

### 02 | Consistência de estoque

Aqui o ponto é que o estoque é lido do ERP, mas a verificação e a baixa não acontecem de forma atômica no fluxo da loja. Em concorrência alta, vários checkouts leem "tem estoque" praticamente ao mesmo tempo, antes de qualquer baixa — a clássica condição de corrida. E como a gente não pode mexer no ERP, a loja não tem hoje um ponto único que garanta a reserva.

O resultado é vender o que não existe, o que vira cancelamento, estorno, custo de atendimento e, pior de tudo, perda de confiança do cliente.

A primeira hipótese seria criar uma reserva de estoque atômica na borda da loja — um decremento que não permita duas reservas simultâneas passarem — antes de confirmar o pedido, deixando a baixa real no ERP pra um momento posterior, de forma conciliada.

### 03 | Resiliência do checkout

O checkout chama o ERP de forma síncrona e bloqueante pra gerar o faturamento. Como o ERP está lento sob carga, a requisição estoura o timeout e o cliente perde a compra — às vezes mesmo quando o pedido ainda poderia ser concluído do lado do ERP.

Isso é perda de venda direta e uma experiência péssima: o cliente fica sem saber se comprou, tenta de novo e pode acabar duplicando o pedido.

O caminho que eu investigaria é desacoplar o faturamento do clique de comprar: aceitar o pedido rápido (com a reserva de estoque garantida), enfileirar a geração de faturamento e processar de forma assíncrona, com timeout, retry e idempotência pra não duplicar.

---

## Pergunta 2 — Infraestrutura e serviços de apoio

A ideia que guia todo o resto é simples: a loja precisa parar de depender do ERP em cada requisição. O ERP continua sendo a referência de dados, mas consultado o mínimo possível; a loja ganha camadas próprias de leitura e de desacoplamento.

Os recursos que eu usaria:

Cache (Redis, e CDN pra assets) pra servir catálogo e preço a partir de uma cópia com TTL, em vez de bater no ERP a cada visita. Isso sozinho já resolve boa parte da vitrine lenta e tira muita carga do ERP.

Uma fila de mensagens (RabbitMQ, SQS ou Kafka) pra absorver a escrita: o checkout publica o pedido e responde rápido pro cliente, e um worker consome a fila e gera o faturamento no ERP de forma assíncrona, com retry. É o que resolve o timeout e ajuda a aguentar picos.

Uma base de leitura própria da loja — réplica do MySQL ou um banco sincronizado por CDC/ETL — pra consultas de catálogo e estoque não pesarem no ERP transacional.

Junto disso, um worker de reconciliação com idempotência, garantindo que reserva e faturamento batam e que retries não gerem pedido duplicado. E, como apoio, circuit breaker, timeouts e a observabilidade que a empresa já tem, pra isolar falhas do ERP e enxergar os gargalos.

No fim, o padrão é esse: cache na leitura, fila na escrita. As chamadas síncronas e frágeis pro ERP viram interações resilientes.

Um trade-off honesto: ao usar cache e sincronização assíncrona, a loja passa a trabalhar com dados eventualmente consistentes. Pra preço e descrição isso é tranquilo; pra estoque exige cuidado, e é justamente por isso que trato a reserva atômica como uma solução à parte, fora do cache.

---

## Pergunta 3 — SDD: Spec-Driven Development (`POST /checkout`)

O que o endpoint recebe:

```json
{
  "productId": "case-iphone-15",   // obrigatório
  "quantity": 2,                    // obrigatório, inteiro > 0
  "idempotencyKey": "uuid-opcional" // recomendado pra evitar duplicidade em retry
}
```

Num sistema com autenticação real entrariam também cliente, endereço e pagamento, mas isso está fora do escopo do desafio.

Em caso de sucesso, devolve `201 Created` com o pedido confirmado:

```json
{
  "order": {
    "orderId": "uuid",
    "invoiceId": "INV-xxxx",
    "productId": "case-iphone-15",
    "productName": "Capinha iPhone 15",
    "quantity": 2,
    "unitPriceInCents": 4990,
    "totalInCents": 9980,
    "remainingStock": 8,
    "status": "CONFIRMED"
  }
}
```

Em caso de erro, sempre o mesmo formato — `{ "error": { "code", "message", "details?" } }` — variando o status:

| Cenário | HTTP | code |
|---|---|---|
| Entrada inválida (qty ≤ 0, falta campo) | `400` | `VALIDATION_ERROR` |
| Produto inexistente | `404` | `PRODUCT_NOT_FOUND` |
| Estoque insuficiente | `409` | `INSUFFICIENT_STOCK` |
| ERP indisponível / timeout | `503` | `ERP_UNAVAILABLE` |
| Erro inesperado | `500` | `INTERNAL_ERROR` |

Definir esse contrato antes de codar vale por alguns motivos práticos. Front e back conseguem tocar em paralelo, porque o contrato é o acordo entre os dois. Pensar os erros antes evita que o tratamento de falha vire remendo lá no fim. E os testes saem naturalmente do contrato. No geral, mexer num contrato ainda no papel é barato; mexer em código já pronto e consumido pelo front é bem mais caro.

---

## Pergunta 4 — TDD: Test-Driven Development (`POST /checkout`)

Os cenários que eu cobriria (implementados em `backend/src/__tests__/checkout.test.ts`):

1. Sucesso (201): produto válido e estoque suficiente, pedido confirmado, estoque baixado certo e total calculado.
2. Validação (400): `quantity = 0`, negativa ou sem `productId`, retornando `VALIDATION_ERROR` sem encostar no estoque.
3. Produto inexistente (404): `productId` desconhecido.
4. Estoque insuficiente (409): quantidade maior que o disponível.
5. ERP indisponível (503) com rollback: o faturamento falha e a reserva de estoque é devolvida, não some.
6. Concorrência: 5 compras simultâneas de um item com estoque 1 — só uma confirma, as outras quatro recebem 409.
7. Idempotência: mesma `idempotencyKey` enviada duas vezes gera um pedido só, com baixa única.

Sobre escrever os testes antes: além de já deixar o contrato e os casos de erro pensados de cara, o maior ganho é a liberdade pra refatorar depois (trocar memória por banco ou fila, por exemplo) sem medo de quebrar comportamento. E ajuda a não esquecer os cenários chatos — estoque zerado, ERP fora — que são exatamente os que o case quer ver tratados.

---

## Pergunta 5 — Uso de IA para o Problema 2 (Furo de Estoque)

Mantendo a restrição de não poder alterar o ERP, eu conduziria a conversa com a IA mais ou menos assim:

Começaria pelo contexto e pela restrição: "A loja lê estoque de um ERP MySQL read-only, não posso alterar tabelas nem rotinas. Sob concorrência, vários checkouts vendem o mesmo item quando o estoque acaba. Explique a causa raiz e proponha onde inserir o controle fora do ERP."

Depois pediria o desenho com trade-offs: comparar reserva atômica em Redis, lock distribuído e fila serializada por produto, pesando consistência, performance e complexidade de cada uma.

Em seguida, código já testável: um serviço de checkout que faz a reserva atômica antes de chamar o ERP e dá rollback se o faturamento falhar, com idempotência por chave — e que os testes viessem primeiro.

E, por fim, uma revisão crítica do que saiu: procurar condições de corrida que tenham escapado e cenários onde o estoque possa "vazar" (falha entre reservar e confirmar), além de pensar a reconciliação com o estoque real do ERP.

No fim, a IA serve de acelerador e de segunda opinião, mas quem decide onde colocar a reserva e como conciliar isso com o estoque real do ERP sou eu. É decisão de arquitetura, não de digitação.

---

## Parte 1.B — Mini-tarefa de Código

Repositório público com a implementação (back-end Node + TypeScript, front React + TypeScript, testes e README):

**https://github.com/Caio-Dias02/Challenge-CellShop**

Os prompts de IA usados ao longo do desafio estão no `PROMPTS.md` do próprio repositório.