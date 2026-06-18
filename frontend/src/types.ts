export interface Product {
  id: string;
  name: string;
  priceInCents: number;
  stock: number;
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

export interface ApiError {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
}
