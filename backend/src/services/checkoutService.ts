import { randomUUID } from 'node:crypto';
import { findProduct, releaseStock, reserveStock } from '../domain/products';
import { createInvoice, ErpUnavailableError } from './erpClient';

export interface CheckoutInput {
  productId: string;
  quantity: number;
  /** Chave de idempotência opcional para evitar pedidos duplicados em retries. */
  idempotencyKey?: string;
}

export interface CheckoutOrder {
  orderId: string;
  invoiceId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceInCents: number;
  totalInCents: number;
  remainingStock: number;
  status: 'CONFIRMED';
}

/** Erros de negócio com um código estável que o controller traduz em HTTP. */
export type CheckoutErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'ERP_UNAVAILABLE';

export class CheckoutError extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/** Cache simples de respostas por idempotencyKey (em memória). */
const processedOrders = new Map<string, CheckoutOrder>();

export async function processCheckout(input: CheckoutInput): Promise<CheckoutOrder> {
  const { productId, quantity, idempotencyKey } = input;

  // 1. Idempotência: se já processamos essa chave, devolve o mesmo resultado.
  if (idempotencyKey && processedOrders.has(idempotencyKey)) {
    return processedOrders.get(idempotencyKey)!;
  }

  // 2. Produto existe?
  const product = findProduct(productId);
  if (!product) {
    throw new CheckoutError('PRODUCT_NOT_FOUND', `Produto "${productId}" não encontrado.`);
  }

  // 3. Reserva atômica do estoque ANTES de chamar o ERP.
  //    Isso evita o "furo de estoque" (Problema 2): a baixa acontece em uma
  //    operação síncrona, então duas compras concorrentes não vendem o mesmo item.
  const remainingStock = reserveStock(productId, quantity);
  if (remainingStock === null) {
    throw new CheckoutError(
      'INSUFFICIENT_STOCK',
      `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}.`,
    );
  }

  const orderId = randomUUID();

  // 4. Faturamento no ERP. Se falhar, devolvemos o estoque reservado (rollback).
  try {
    const { invoiceId } = await createInvoice(orderId);

    const order: CheckoutOrder = {
      orderId,
      invoiceId,
      productId: product.id,
      productName: product.name,
      quantity,
      unitPriceInCents: product.priceInCents,
      totalInCents: product.priceInCents * quantity,
      remainingStock,
      status: 'CONFIRMED',
    };

    if (idempotencyKey) processedOrders.set(idempotencyKey, order);
    return order;
  } catch (err) {
    releaseStock(productId, quantity);
    if (err instanceof ErpUnavailableError) {
      throw new CheckoutError('ERP_UNAVAILABLE', err.message);
    }
    throw err;
  }
}

/** Apenas para testes. */
export function __clearIdempotencyCache(): void {
  processedOrders.clear();
}
