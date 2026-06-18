import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { listProducts } from './domain/products';
import { CheckoutError, processCheckout } from './services/checkoutService';
import { isErpAvailable, setErpAvailable } from './services/erpClient';

// Schema de validação do corpo do checkout (Problema: validações mínimas).
const checkoutSchema = z.object({
  productId: z.string({ required_error: 'productId é obrigatório.' }).min(1, 'productId é obrigatório.'),
  quantity: z
    .number({ required_error: 'quantity é obrigatório.', invalid_type_error: 'quantity deve ser um número.' })
    .int('quantity deve ser inteiro.')
    .positive('quantity deve ser maior que zero.'),
  idempotencyKey: z.string().min(1).optional(),
});

const codeToStatus: Record<string, number> = {
  PRODUCT_NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409,
  ERP_UNAVAILABLE: 503,
};

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', erpAvailable: isErpAvailable() });
  });

  // Lista de produtos para a vitrine do front-end.
  app.get('/products', (_req, res) => {
    res.json({ products: listProducts() });
  });

  // Endpoint principal: tentativa de compra.
  app.post('/checkout', async (req: Request, res: Response, next: NextFunction) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados de entrada inválidos.',
          details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }

    try {
      const order = await processCheckout(parsed.data);
      return res.status(201).json({ order });
    } catch (err) {
      if (err instanceof CheckoutError) {
        return res.status(codeToStatus[err.code] ?? 500).json({
          error: { code: err.code, message: err.message },
        });
      }
      return next(err);
    }
  });

  // Rota de DEMONSTRAÇÃO: liga/desliga o ERP para exibir o cenário de
  // indisponibilidade no front-end. Em produção isto não existiria.
  app.post('/dev/erp', (req, res) => {
    const available = Boolean(req.body?.available);
    setErpAvailable(available);
    res.json({ erpAvailable: isErpAvailable() });
  });

  // Tratador de erros inesperados (500).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Erro inesperado:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } });
  });

  return app;
}
