import formatReport from './format.js';
import { loadSales } from './data.js';

const sales = loadSales();
console.log(formatReport(sales, { currency: 'EUR' }));
