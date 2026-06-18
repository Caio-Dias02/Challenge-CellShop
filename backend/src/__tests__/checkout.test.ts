import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { __resetStockForTests } from '../domain/products';
import { __clearIdempotencyCache } from '../services/checkoutService';
import { setErpAvailable, setErpLatency } from '../services/erpClient';

let app: Express;

beforeEach(() => {
  __resetStockForTests();
  __clearIdempotencyCache();
  setErpAvailable(true);
  setErpLatency(10);
  app = createApp();
});

describe('POST /checkout', () => {
  it('confirma a compra e baixa o estoque (sucesso -> 201)', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({ productId: 'case-iphone-15', quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      productId: 'case-iphone-15',
      quantity: 2,
      remainingStock: 8,
      status: 'CONFIRMED',
    });
    expect(res.body.order.totalInCents).toBe(9980);
    expect(res.body.order.orderId).toBeDefined();
  });

  it('rejeita entrada inválida (quantity <= 0 -> 400)', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({ productId: 'case-iphone-15', quantity: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejeita corpo sem productId (-> 400)', async () => {
    const res = await request(app).post('/checkout').send({ quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('retorna 404 quando o produto não existe', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({ productId: 'inexistente', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('retorna 409 quando não há estoque suficiente', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({ productId: 'case-pixel-8', quantity: 5 }); // estoque = 1

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('retorna 503 e faz rollback do estoque quando o ERP está indisponível', async () => {
    setErpAvailable(false);
    const res = await request(app)
      .post('/checkout')
      .send({ productId: 'case-iphone-15', quantity: 1 });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ERP_UNAVAILABLE');

    // O estoque não pode ter sido consumido após a falha do ERP.
    setErpAvailable(true);
    const ok = await request(app)
      .post('/checkout')
      .send({ productId: 'case-iphone-15', quantity: 10 });
    expect(ok.status).toBe(201);
    expect(ok.body.order.remainingStock).toBe(0);
  });

  it('não vende além do estoque em compras concorrentes (anti furo de estoque)', async () => {
    // case-pixel-8 tem estoque = 1. Disparamos 5 compras simultâneas.
    const requests = Array.from({ length: 5 }, () =>
      request(app).post('/checkout').send({ productId: 'case-pixel-8', quantity: 1 }),
    );
    const results = await Promise.all(requests);

    const confirmed = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(confirmed).toHaveLength(1);
    expect(rejected).toHaveLength(4);
  });

  it('é idempotente: mesma idempotencyKey não baixa o estoque duas vezes', async () => {
    const body = { productId: 'case-galaxy-s24', quantity: 1, idempotencyKey: 'abc-123' };

    const first = await request(app).post('/checkout').send(body);
    const second = await request(app).post('/checkout').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.order.orderId).toBe(second.body.order.orderId);
    expect(second.body.order.remainingStock).toBe(4); // baixou só 1 (5 -> 4)
  });
});
