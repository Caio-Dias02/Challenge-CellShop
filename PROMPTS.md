# PROMPTS.md — IA no desenvolvimento

O desafio permite e incentiva o uso de IA, e eu usei mais como um par do que como
gerador. Abaixo estão os prompts mais relevantes, na ordem em que as coisas realmente
aconteceram: primeiro a base funcionando, depois fui lapidando regra de negócio, UX e
a escrita dos documentos.

## 1. Estrutura e base

As escolhas de desenho estão no README: camadas separadas (dados em memória, um serviço
com a regra de negócio e a rota só validando), Zod na validação e um status HTTP pra
cada desfecho. Usei a IA pra montar o esqueleto a partir disso e adiantar o código
repetitivo.

> "Monta a estrutura desse checkout em camadas: produtos/estoque em memória, um serviço
> de checkout com a regra de negócio, e a rota Express só validando (com Zod) e
> traduzindo erro pra HTTP. Cada desfecho com o status certo: 400 validação, 404 produto
> inexistente, 409 sem estoque, 503 ERP fora."

## 2. Resolver os problemas do case na regra de negócio

> "O problema 2 do case é furo de estoque (vende o que não tem). Faz a reserva do
> estoque ANTES de chamar o ERP, de forma atômica, e se o ERP falhar devolve o estoque
> (rollback). Quero que duas compras concorrentes não vendam o mesmo item."

> "Adiciona idempotência por chave pra um retry do cliente não duplicar o pedido."

> "Cria um ERP simulado que eu consiga ligar/desligar, pra demonstrar o cenário de
> indisponibilidade (o 503) sem precisar de um ERP de verdade."

## 3. Testes (TDD)

> "Escreve os testes com Vitest + Supertest cobrindo os casos que o case cobra: sucesso,
> entrada inválida, produto inexistente, estoque insuficiente, ERP fora com rollback,
> concorrência (5 compras de um item com estoque 1, só uma passa) e idempotência."

A validação acabou virando dois testes (quantidade inválida e campo faltando), então
no fim são 8 testes no total.

## 4. Lapidar a UX (aqui foi indo no detalhe)

> "Na tela: lista os produtos, escolhe quantidade, botão comprar. Mostra quando está
> processando, trava o botão pra não clicar duas vezes, e mensagem clara de sucesso ou erro."

> "Deixar o id do pedido e do faturamento, os dois como código solto, confunde o
> usuário. Tira o faturamento da tela e deixa só um número de pedido discreto."

> "Esse preço no `<select>` está cortado atrás da setinha. Arruma — deixa só o nome no
> select e joga preço e estoque numa linha embaixo."

## Onde discordei da IA

Numa revisão, a IA apontou uma suposta inconsistência de status (sugeriu `504` pra
timeout) e recomendou trocar a tabela da API pra `/api/products`. Fui conferir no
código antes de aceitar: o ERP simulado é um toggle on/off, então `503` é o status
correto pro caso; e o `vite.config.ts` já faz rewrite removendo o `/api`, ou seja, as
rotas reais do back são `/products` e `/checkout`. Mantive os dois como estavam. As
duas sugestões quebrariam o projeto.

## Como usei a IA de forma responsável

Resumindo o que a IA fez e o que foi meu: ela acelerou bastante o boilerplate, a
estrutura e os testes, e foi útil pra pesar alternativas. As decisões de arquitetura
(reserva atômica, idempotência, contrato de erro) eu revisei uma a uma, ajustei o que
não fazia sentido e rodei os testes antes de confiar. No fim, o `npm test` passa os 8
testes e o front builda limpo.
