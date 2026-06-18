export interface Product {
  id: string;
  name: string;
  /** Preço unitário em centavos, para evitar erros de ponto flutuante. */
  priceInCents: number;
  stock: number;
}

/**
 * "Banco" em memória. Em produção isto seria uma tabela/serviço de estoque.
 * O estado é mutável de propósito para simular reserva/baixa de estoque.
 */
const products: Product[] = [
  { id: 'case-iphone-15', name: 'Capinha iPhone 15 - Transparente', priceInCents: 4990, stock: 10 },
  { id: 'case-galaxy-s24', name: 'Capinha Galaxy S24 - Silicone Preto', priceInCents: 3990, stock: 5 },
  { id: 'case-pixel-8', name: 'Capinha Pixel 8 - Couro Marrom', priceInCents: 6990, stock: 1 },
  { id: 'case-moto-g84', name: 'Capinha Moto G84 - Anti-impacto', priceInCents: 2990, stock: 0 },
];

export function listProducts(): Product[] {
  return products.map((p) => ({ ...p }));
}

export function findProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

/**
 * Tenta reservar `quantity` unidades de forma atômica (síncrona, sem await no meio).
 * Retorna o estoque restante em caso de sucesso ou `null` se não houver estoque.
 */
export function reserveStock(id: string, quantity: number): number | null {
  const product = products.find((p) => p.id === id);
  if (!product || product.stock < quantity) return null;
  product.stock -= quantity;
  return product.stock;
}

/** Devolve unidades reservadas (usado quando o ERP falha após a reserva). */
export function releaseStock(id: string, quantity: number): void {
  const product = products.find((p) => p.id === id);
  if (product) product.stock += quantity;
}

/** Apenas para testes: restaura o estado inicial do estoque. */
export function __resetStockForTests(): void {
  const seed: Record<string, number> = {
    'case-iphone-15': 10,
    'case-galaxy-s24': 5,
    'case-pixel-8': 1,
    'case-moto-g84': 0,
  };
  for (const p of products) p.stock = seed[p.id];
}
