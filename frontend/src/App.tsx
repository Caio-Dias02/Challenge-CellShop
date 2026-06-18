import { useEffect, useRef, useState } from 'react';
import { checkout, CheckoutRequestError, fetchProducts, setErpAvailable } from './api';
import type { CheckoutOrder, Product } from './types';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; order: CheckoutOrder }
  | { kind: 'error'; message: string };

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [erpDown, setErpDown] = useState(false);

  // Chave de idempotência: mesma "intenção de compra" reusa a chave em retries,
  // e gera uma nova após sucesso ou troca de produto/quantidade.
  const idempotencyKey = useRef(crypto.randomUUID());
  const renewKey = () => (idempotencyKey.current = crypto.randomUUID());

  async function loadProducts() {
    setLoadingProducts(true);
    setProductsError(null);
    try {
      const list = await fetchProducts();
      setProducts(list);
      if (list.length > 0 && !productId) setProductId(list[0].id);
    } catch {
      setProductsError('Não foi possível carregar a vitrine. Tente novamente.');
    } finally {
      setLoadingProducts(false);
    }
  }

  useEffect(() => {
    void loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = products.find((p) => p.id === productId);
  const isProcessing = status.kind === 'loading';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isProcessing) return; // trava reentrância (evita ação duplicada)

    setStatus({ kind: 'loading' });
    try {
      const order = await checkout({
        productId,
        quantity,
        idempotencyKey: idempotencyKey.current,
      });
      setStatus({ kind: 'success', order });
      renewKey();
      // Atualiza o estoque exibido na vitrine.
      setProducts((prev) =>
        prev.map((p) => (p.id === order.productId ? { ...p, stock: order.remainingStock } : p)),
      );
    } catch (err) {
      setStatus({ kind: 'error', message: messageFor(err) });
    }
  }

  async function toggleErp() {
    const next = !erpDown;
    setErpDown(next);
    await setErpAvailable(!next); // erpDown=true => ERP indisponível
  }

  return (
    <main className="container">
      <header className="app-header">
        <h1>CaseCellShop</h1>
        <p className="subtitle">Checkout de capinhas — demo do desafio técnico</p>
      </header>

      {/* Controle de DEMO para exibir o cenário de ERP indisponível */}
      <label className="erp-toggle">
        <input type="checkbox" checked={erpDown} onChange={toggleErp} />
        <span className="switch" aria-hidden="true" />
        Simular ERP indisponível (demonstra erro 503)
      </label>

      {loadingProducts && <p className="muted">Carregando produtos…</p>}

      {productsError && (
        <div className="alert alert-error">
          {productsError} <button onClick={() => void loadProducts()}>Recarregar</button>
        </div>
      )}

      {!loadingProducts && !productsError && (
        <form onSubmit={handleSubmit} className="card">
          <label>
            Produto
            <select value={productId} onChange={(e) => { setProductId(e.target.value); renewKey(); }}>
              {products.map((p) => (
                <option key={p.id} value={p.id} disabled={p.stock === 0}>
                  {p.name}
                  {p.stock === 0 ? ' (esgotado)' : ''}
                </option>
              ))}
            </select>
            {selected && (
              <span className="product-detail">
                {brl(selected.priceInCents)}
                {' · '}
                {selected.stock > 0 ? `${selected.stock} em estoque` : 'Esgotado'}
              </span>
            )}
          </label>

          <label>
            Quantidade
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => { setQuantity(Number(e.target.value)); renewKey(); }}
            />
          </label>

          {selected && (
            <div className="total">
              <span>Total</span>
              <strong>{brl(selected.priceInCents * Math.max(quantity, 0))}</strong>
            </div>
          )}

          <button type="submit" disabled={isProcessing || !selected || selected.stock === 0}>
            {isProcessing ? 'Processando…' : 'Comprar'}
          </button>
        </form>
      )}

      {status.kind === 'success' && (
        <div className="alert alert-success">
          <strong className="alert-title">Compra confirmada!</strong>
          <p className="confirm-product">
            {status.order.quantity}× {status.order.productName}
          </p>
          <p className="confirm-meta">
            Total <strong>{brl(status.order.totalInCents)}</strong>
            <span> · Estoque restante: {status.order.remainingStock}</span>
          </p>
          <p className="confirm-ref">
            Nº do pedido: <code>{status.order.orderId.slice(0, 8).toUpperCase()}</code>
          </p>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="alert alert-error">{status.message}</div>
      )}
    </main>
  );
}

/** Traduz erros da API em mensagens compreensíveis para o usuário. */
function messageFor(err: unknown): string {
  if (err instanceof CheckoutRequestError) {
    switch (err.apiError.code) {
      case 'VALIDATION_ERROR':
        return err.apiError.details?.map((d) => d.message).join(' ') ?? 'Dados inválidos.';
      case 'PRODUCT_NOT_FOUND':
        return 'Produto não encontrado.';
      case 'INSUFFICIENT_STOCK':
        return 'Estoque insuficiente para a quantidade desejada.';
      case 'ERP_UNAVAILABLE':
        return 'Não foi possível concluir agora (sistema de faturamento indisponível). Tente novamente em instantes.';
      default:
        return err.apiError.message;
    }
  }
  return 'Falha de conexão. Verifique sua internet e tente novamente.';
}
