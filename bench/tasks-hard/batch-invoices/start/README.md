# invoicing

Builds invoices from orders. All money is integer cents. Order prices are in EUR; an invoice is in
the customer's currency, converted with the EUR exchange rate valid on the invoice date (the latest
rate published on or before that date, see `data/rates.json`).

- `src/index.js`: `generateInvoice(order)` and `generateBatch(orders)`.
- `src/cli.js`: prints one line per invoice for a JSON file of orders.
- Customer settings in `data/customers.json` override the defaults in `src/config.js`.
