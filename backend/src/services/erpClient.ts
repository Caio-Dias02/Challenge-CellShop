/**
 * Cliente simulado do ERP.
 *
 * No case real, o ERP é síncrono e lento: gera faturamento e às vezes sofre
 * timeout. Aqui simulamos esse comportamento para exercitar o tratamento de
 * erro/indisponibilidade no checkout, sem depender de um ERP de verdade.
 */

export class ErpUnavailableError extends Error {
  constructor(message = 'ERP indisponível ou lento para faturar') {
    super(message);
    this.name = 'ErpUnavailableError';
  }
}

let erpAvailable = true;
let erpLatencyMs = 150;

/** Liga/desliga o ERP (usado pela rota de demonstração e pelos testes). */
export function setErpAvailable(available: boolean): void {
  erpAvailable = available;
}

export function isErpAvailable(): boolean {
  return erpAvailable;
}

export function setErpLatency(ms: number): void {
  erpLatencyMs = ms;
}

export interface InvoiceResult {
  invoiceId: string;
}

/**
 * Simula a chamada síncrona ao ERP para gerar o faturamento do pedido.
 * Lança `ErpUnavailableError` quando o ERP está "fora" ou estoura o timeout.
 */
export async function createInvoice(
  orderId: string,
  timeoutMs = 1000,
): Promise<InvoiceResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!erpAvailable) {
        reject(new ErpUnavailableError());
        return;
      }
      resolve({ invoiceId: `INV-${orderId.slice(0, 8)}` });
    }, erpLatencyMs);

    // Timeout de proteção: não deixamos o cliente esperar indefinidamente.
    if (erpLatencyMs >= timeoutMs) {
      clearTimeout(timer);
      reject(new ErpUnavailableError('Timeout ao aguardar o ERP'));
    }
  });
}
