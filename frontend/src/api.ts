import type { ApiError, CheckoutOrder, Product } from './types';

const BASE = '/api';

/** Erro tipado para o front diferenciar mensagens por código. */
export class CheckoutRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiError: ApiError,
  ) {
    super(apiError.message);
  }
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(`${BASE}/products`);
  if (!res.ok) throw new Error('Não foi possível carregar os produtos.');
  const data = (await res.json()) as { products: Product[] };
  return data.products;
}

export interface CheckoutPayload {
  productId: string;
  quantity: number;
  idempotencyKey: string;
}

export async function checkout(payload: CheckoutPayload): Promise<CheckoutOrder> {
  const res = await fetch(`${BASE}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const apiError: ApiError = body?.error ?? {
      code: 'UNKNOWN',
      message: 'Erro inesperado ao processar a compra.',
    };
    throw new CheckoutRequestError(res.status, apiError);
  }

  return (body as { order: CheckoutOrder }).order;
}

/** Apenas para DEMO: liga/desliga o ERP para mostrar o cenário de indisponibilidade. */
export async function setErpAvailable(available: boolean): Promise<void> {
  await fetch(`${BASE}/dev/erp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ available }),
  });
}
